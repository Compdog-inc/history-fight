process.on("uncaughtException", (e) => {
	console.log("Error: " + e);
});

process.on("unhandledRejection", (r) => {
	console.log("Rejection: " + r);
});

const express = require('express');
const app = express();
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const client = new Client({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		rejectUnauthorized: false
	}
});

var rooms = [{
	code: "123456",
	teams: [],
	clients: [],
	settings: {
		maxPlayers: 5,
		maxTeams:-1
	}
},
	{
		code: "654321",
		teams: [],
		clients: [],
		settings: {
			maxPlayers: 3,
			maxTeams: -1
		}
	}];

app.use(cors());
app.set('trust proxy', true);

var jsonParser = bodyParser.json();
var urlencodedParser = bodyParser.urlencoded({
	extended: false
});

function endsWith(str, endings) {
	for (var i = 0; i < endings.length; i++) {
		if (str.endsWith(endings[i])) {
			console.log(str + ", ends with " + endings[i]);
			return true;
		}
    }
	return false;
}

app.get("/favicon.ico", function (req, res) {
	res.sendFile("favicon.ico", {
		root: path.join(__dirname, 'public'),
		headers: {
			'x-timestamp': Date.now(),
			'x-sent': true
		}
	});
});

app.get("/files/:filefolder/:filename", function (req, res) {
	var p = path.join(__dirname, 'public/files/', req.params.filefolder,req.params.filename);
	fs.access(p, fs.F_OK, (err) => {
		if (err) {
			res.status(404).send("404 (Not Found)");
			return;
		}

		if (req.params.filename.endsWith(".gz"))
			res.set('Content-Encoding', 'gzip');

		if (req.params.filename.endsWith(".br"))
			res.set('Content-Encoding', 'br')

		if (endsWith(req.params.filename, [".wasm", ".wasm.gz", ".wasm.br"]))
			res.set('Content-Type', 'application/wasm');

		if (endsWith(req.params.filename, [".js", ".js.gz", ".js.br"]))
			res.set('Content-Type', 'application/javascript');

		fs.readFile(p, function (err, data) {
			if (err) {
				return console.log(err);
			}

			res.end(data);
		});
	});
});

app.get("*", function (req, res) {
	res.send(`<!DOCTYPE html>
<html>
<head>
	<title>History Fight</title>
</head>
<body>
	<p>Oh hi! Didn't think you would come here... Here's a super cool <a href="http://www.compdog.tk">website</a>!</p>
</body>
</html>`);
});

wss.on('connection', (ws, req) => {
	var roomCode = req.url.substr(1);
	var room = getRoomByCode(roomCode);
	if (room == null) {
		ws.on('message', () => {
			ws.close();
		});

		ws.send("4001");
		return;
	}
	ws.isAlive = true;

	var id = generateId();

	room.clients.push({ client: ws, id: id });

	console.log(`New Connection '${id}' room '${room.code}'`);

	ws.send("4000");

	ws.on('pong', () => {
		ws.isAlive = true;
	});

	ws.on('message', (message) => {
		try {
			var eventObject = JSON.parse(message);
			parseEvent(eventObject, ws, room);
		} catch (e) {
			console.error("Error parsing event: " + e);
        }
	});

	ws.on('close', (e) => {
		removeClient(ws, room);
		if (e.wasClean) {
			console.log(`Connection closed cleanly, code=${event.code} reason=${event.reason}`);
		} else {
			console.log("Connection died");
		}
	});
});

function generateId() {
	return uuidv4();
}

function getRoomByCode(code) {
	for (var i = 0; i < rooms.length; i++)
		if (rooms[i].code == code)
			return rooms[i];
	return null;
}

function getClientById(id, room) {
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].id == id)
			return room.clients[i].client;
	return null;
}

function getIdByClient(ws, room) {
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].client == ws)
			return room.clients[i].id;
	return null;
}

function removeClientIdInTeam(id, team) {
	if (team.Players.includes(id))
		team.Players.removeObject(id);
}

function getTeamByClientId(id, room) {
	for (var i = 0; i < room.teams.length; i++)
		for (var j = 0; j < room.teams[i].Players.length; j++)
			if (room.teams[i].Players[j] == id)
				return room.teams[i];
	return null;
}

function removeClient(ws, room) {
	var clientId = getIdByClient(ws, room);
	var clientTeam = getTeamByClientId(clientId, room);
	console.log("T: " + clientTeam);
	console.log("T: " + clientTeam.Players);
	removeClientIdInTeam(clientId, clientTeam);
	console.log(JSON.stringify(clientTeam));

	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].client == ws) {
			room.clients.splice(i, 1);
			return;
		}
}

function sendToAll(eventObject, room) {
	for (var i = 0; i < room.clients.length; i++)
		sendEvent(eventObject, room.clients[i].client, room);
}

function sendToTeam(eventObject, room, team) {
	for (var i = 0; i < team.Players.length; i++)
		sendEvent(eventObject, getClientById(team.Players[i], room), room);
}

function sendEvent(eventObject, ws, room) {
	var str = JSON.stringify(eventObject);
	ws.send(str);
	console.log("Sent to " + getIdByClient(ws, room));
}

function parseEvent(eventObject, ws, room) {
	console.log("Got " + eventObject.Name);
	switch (eventObject.Name) {
		case "ListTeamsEvent":
			eventObject.Teams = room.teams;
			sendEvent(eventObject, ws, room);
			break;
		case "AddTeamEvent":
			var newTeam = { Uuid: generateId(), Name: eventObject.TeamName, CurrentMemberCount: 1, TotalMemberCount: room.settings.maxPlayers, Players: [getIdByClient(ws, room),""] };
			room.teams.push(newTeam);
			sendToAll({ Name: "NewTeamEvent", Team: newTeam }, room);
			console.log(JSON.stringify(newTeam));
			break;
	}
}

client.connect();

server.listen(process.env.PORT || 3000,
	() => {
		setInterval(() => {
			wss.clients.forEach((ws) => {
				if (!ws.isAlive) {
					console.log("Dead socket :(");
					return ws.terminate();
				}
				ws.isAlive = false;
				ws.ping(null, false, true);
			});
		}, 10000);
		console.log("Server Started.");
	});