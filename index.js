const os = require('os')
const bytes = require('bytes')
const logger = require('morgan')
const express = require('express')
const CharacterAI = require('./characterai')
const Parser = require('./characterai/parser')

const characterAI = new CharacterAI()

const app = express()
app.set('json spaces', 4)
app.use(logger('dev'))

app.all('/', (req, res) => {
	const obj = {}
	const used = process.memoryUsage()
	for (let key in used) obj[key] = formatSize(used[key])
	
	const totalmem = os.totalmem()
	const freemem = os.freemem()
	obj.memoryUsage = `${formatSize(totalmem - freemem)} / ${formatSize(totalmem)}`
	
	res.json({
		success: true,
		message: 'Hello World!',
		uptime: new Date(process.uptime() * 1000).toUTCString().split(' ')[4],
		status: obj
	})
})

app.get('/api', async (req, res) => {
	try {
		let { characterId, text, sessionId } = req.query
		if (!characterId) return res.json({ success: false, message: 'Input parameter characterId' })
		if (!text) return res.json({ success: false, message: 'Input parameter text' })
		
		if (!sessionId) {
			const request = await characterAI.requester.request('https://beta.character.ai/chat/history/create/', {
				headers: characterAI.getHeaders(), method: 'POST',
				body: Parser.stringify({ character_external_id: characterId })
			})
			if (!request.ok()) return res.json({ success: false, message: 'Couldn\'t create a new chat' })
			
			const json = await Parser.parseJSON(request)
			sessionId = json.external_id
		}
		
		const chat = await characterAI.createOrContinueChat(characterId, sessionId)
		const response = await chat.sendAndAwaitResponse(text, true)
		const urlAvatar = `https://characterai.io/i/80/static/avatars/${response.srcAvatarFileName}`
			
		delete response.chat
		res.json({
			success: true,
			message: '',
			result: { ...response, urlAvatar, sessionId }
		})
	} catch (e) {
		console.log(e)
		res.json({ error: true, message: String(e) === '[object Object]' ? 'Internal Server Error' : String(e) })
	}
})

app.get('/api/chara/info', async (req, res) => {
	try {
		const { characterId } = req.query
		if (!characterId) return res.json({ success: false, message: 'Input parameter characterId' })
		
		const result = await characterAI.fetchCharacterInfo(characterId)
		if (!result) return res.json({ success: false, message: 'Invalid characterId' })
		
		res.json({ success: true, message: '', result })
	} catch (e) {
		console.log(e)
		res.json({ error: true, message: String(e) === '[object Object]' ? 'Internal Server Error' : String(e) })
	}
})

app.get('/api/chara/search', async (req, res) => {
	try {
		const { name } = req.query
		if (!name) return res.json({ success: false, message: 'Input parameter name' })
		
		const { characters } = await characterAI.searchCharacters(name)
		if (!characters.length) return res.json({ success: false, message: 'Character not found' })
		
		res.json({ success: true, message: '', result: characters })
	} catch (e) {
		console.log(e)
		res.json({ error: true, message: String(e) === '[object Object]' ? 'Internal Server Error' : String(e) })
	}
})

const PORT = process.env.PORT || 3000
app.listen(PORT, async () => {
	console.log('App running on port', PORT)
	await characterAI.authenticateWithToken(process.env.cToken)
})

function formatSize(num) {
	return bytes(+num, { unitSeparator: ' ' })
}
