
const puppeteer = require("puppeteer-core");
// const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const chrome = require("@sparticuz/chromium");
// const fs = require("fs");


class Requester {
    browser = undefined;
    page = undefined;

    #initialized = false;
    #hasDisplayed = false;

    headless = "new";
    puppeteerLaunchArgs = [
        "--fast-start",
        "--disable-extensions",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--no-gpu",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--override-plugin-power-saver-for-testing=never",
        "--disable-extensions-http-throttling",
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.3"
    ];
    puppeteerNoDefaultTimeout = false;
    puppeteerProtocolTimeout = 0;
    usePlus = false;
    forceWaitingRoom = false;

    constructor() {}
    
    isInitialized() {
        return this.#initialized;
    }
    
    async waitForWaitingRoom(page) {
        if (!this.usePlus || (this.usePlus && this.forceWaitingRoom)) {
            return new Promise(async (resolve) => {
                try {
                    let interval;
                    let pass = true;

                    const minute = 60000; // Update every minute

                    async function check() {
                        if (pass) {
                            pass = false;

                            const waitingRoomTimeLeft = await page.evaluate(async() => {
                                try {
                                    const contentContainer = document.querySelector(".content-container");
                                    const sections = contentContainer.querySelectorAll("section");
                                    const h2Element = sections[1].querySelector("h2");
                                    const h2Text = h2Element.innerText;
                                    const regex = /\d+/g;
                                    const matches = h2Text.match(regex);

                                    if (matches) return matches[0];
                                } catch (error) {
                                    return;
                                }
                            }, minute);

                            const waiting = (waitingRoomTimeLeft != null);
                            if (waiting) {
                                console.log(`[node_characterai] Puppeteer - Currently in cloudflare's waiting room. Time left: ${waitingRoomTimeLeft}`);
                            } else {
                                resolve();
                                clearInterval(interval);
                            }
                            pass = true;
                        }
                    }

                    interval = setInterval(check, minute);
                    await check();
                } catch (error) {
                    console.log("[node_characterai] Puppeteer - There was a fatal error while checking for cloudflare's waiting room");
                    console.log(error);
                }
            });
        }
    }

    async initialize() {
        if (this.isInitialized()) return;

        process.on('exit', () => {
            this.uninitialize();
        });

        console.log("[node_characterai] Puppeteer - This is an experimental feature. Please report any issues on github.");

        // puppeteer.use(StealthPlugin());

        const browser = await puppeteer.launch({
            args: [...chrome.args, "--hide-scrollbars", "--disable-web-security"],
            defaultViewport: chrome.defaultViewport,
            executablePath: await chrome.executablePath(),
            headless: true,
            ignoreHTTPSErrors: true,
        });
        this.browser = browser;

        console.log('berhasil disini!')

        let page = await browser.pages();
        page = page[0];
        this.page = page;

        await page.setRequestInterception(false);

        page.setViewport({
            width: 1920 + Math.floor(Math.random() * 100),
            height: 3000 + Math.floor(Math.random() * 100),
            deviceScaleFactor: 1,
            hasTouch: false,
            isLandscape: false,
            isMobile: false,
        });
        await page.setJavaScriptEnabled(true);
        await page.setDefaultNavigationTimeout(0);

        const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        await page.setUserAgent(userAgent);

        await page.deleteCookie();
        const client = await page.target().createCDPSession();
        await client.send("Network.clearBrowserCookies");
        await client.send("Network.clearBrowserCache");
        await page.goto("https://beta.character.ai/favicon.ico");
        await page.evaluate(() => localStorage.clear());

        await this.waitForWaitingRoom(page);

        console.log("[node_characterai] Puppeteer - Done with setup");
    }

    async request(url, options) {
        const page = this.page;
        const method = options.method;
        const body = (method === "GET" ? {} : options.body);
        const headers = options.headers;

        let response;

        try {
            const payload = {
                method: method,
                headers: headers,
                body: body
            };

            await page.setRequestInterception(false);
            if (!this.#hasDisplayed) {
                console.log("[node_characterai] Puppeteer - Eval-fetching is an experimental feature and may be slower. Please report any issues on github");
                this.#hasDisplayed = true;
            }

            if (url.endsWith("/streaming/")) {
                response = await page.evaluate(async (payload, url) => {
                    const response = await fetch(url, payload);

                    const data = await response.text();
                    const matches = data.match(/\{.*\}/g);
                    const responseText = matches[matches.length - 1];

                    let result = {
                        code: 500
                    };

                    if (!matches) result = null;
                    else {
                        result.code = 200;
                        result.response = responseText;
                    }
                    return result;
                }, payload, url);

                response.status = () => response.code;
                response.text = () => response.response;
            } else {
                await page.setRequestInterception(true);
                let initialRequest = true;

                page.once("request", request => {
                    const data = {
                        method: method,
                        postData: body,
                        headers: headers
                    };

                    if (request.isNavigationRequest() && !initialRequest) {
                        return request.abort();
                    }

                    try {
                        initialRequest = false;
                        request.continue(data);
                    } catch (error) {
                        console.log("[node_characterai] Puppeteer - Non fatal error: " + error);
                    }
                });
                response = await page.goto(url, { waitUntil: "domcontentloaded" });
            }
        } catch (error) {
            console.log("[node_characterai] Puppeteer - " + error);
        }

        return response;
    }

    async uploadImage(options, buffer) {
        const url = "https://beta.character.ai/chat/upload-image/";
        const page = this.page;
        const method = options.method;
        const headers = options.headers;
        const mime = options.mime;

        let response;

        try {
            const payload = {
                method: method,
                headers: headers,
                body: buffer
            };

            await page.setRequestInterception(false);
            if (!this.#hasDisplayed) {
                console.log("[node_characterai] Puppeteer - Image-uploading is an experimental feature and may have bugs. Please report any issues on github");
                this.#hasDisplayed = true;
            }

            response = await page.evaluate(async (payload, url, mime) => {
                const formData = new FormData();

                console.log(mime);
                const b64 = payload.body;

                const b64toBlob = (b64Data, contentType = '', sliceSize = 512) => {
                    const byteCharacters = atob(b64Data);
                    const byteArrays = [];

                    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
                        const slice = byteCharacters.slice(offset, offset + sliceSize);

                        const byteNumbers = new Array(slice.length);
                        for (let i = 0; i < slice.length; i++) {
                            byteNumbers[i] = slice.charCodeAt(i);
                        }

                        const byteArray = new Uint8Array(byteNumbers);
                        byteArrays.push(byteArray);
                    }

                    const blob = new Blob(byteArrays, { type: contentType });
                    return blob;
                };

                const blob = b64toBlob(b64.includes("base64,") ? b64.split("base64,")[1] : b64);
                const file = new File([blob], "image", { type: mime });

                formData.append("image", file);
                delete payload.headers['Content-Type'];
                payload.body = formData;

                const response = await fetch(url, payload);

                const data = await response.text();

                let result = {
                    code: 500
                };

                result.code = 200;
                result.response = data;

                return result;
            }, payload, url, mime);

            response.status = () => response.code;
            response.text = () => response.response;
        } catch (error) {
            console.log("[node_characterai] Puppeteer - " + error);
        }

        return response;
    }

    async uninitialize() {
        try {
            if (this.browser) {
                await this.browser.close();
            }
        } catch (error) {
            console.log("[node_characterai] Puppeteer - Error closing the browser: " + error);
        }
    }
}

module.exports = Requester;
