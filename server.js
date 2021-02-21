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

var clients = [];

var teams = [
	{ Name: "Homyak", CurrentMemberCount: 2, TotalMemberCount: 5 },
	{ Name: "Barbos TEAM", CurrentMemberCount: 4, TotalMemberCount: 5 },
	{ Name: "goose", CurrentMemberCount: 0, TotalMemberCount: 5 }
];

app.use(cors());
app.set('trust proxy', true);

var jsonParser = bodyParser.json();
var urlencodedParser = bodyParser.urlencoded({
	extended: false
});

function endsWith(str, endings) {
	console.log("Checking: " + str);
	for (var i = 0; i < endings.length; i++) {
		if (str.endsWith(endings[i])) {
			console.log(str + ", ends with " + ending[i]);
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
	console.log("REQUEST");
	var p = path.join(__dirname, 'public/files/', req.params.filefolder,req.params.filename);
	console.log("P: " + p);
	fs.access(p, fs.F_OK, (err) => {
		if (err) {
			res.status(404).send("404 (Not Found)");
			return;
		}

		if (req.params.filename.endsWith(".gz"))
			encoding = 'gzip';

		if (req.params.filename.endsWith(".br"))
			encoding = 'br';

		if (endsWith(req.params.filename, [".wasm", ".wasm.gz", ".wasm.br"]))
			res.set('Content-Type', 'application/wasm');

		if (endsWith(req.params.filename, [".js", ".js.gz", ".js.br"]))
			res.set('Content-Type', 'application/javascript');

		fs.readFile(p, function (err, data) {
			if (err) {
				return console.log(err);
			}

			res.send(data);
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

wss.on('connection', (ws) => {
	ws.isAlive = true;

	var id = generateId();

	clients.push({ client: ws, id: id });

	console.log(`New Connection '${id}'`);

	ws.on('pong', () => {
		ws.isAlive = true;
	});

	ws.on('message', (message) => {
		try {
			var eventObject = JSON.parse(message);
			parseEvent(eventObject, ws);
		} catch (e) {
			console.error("Error parsing event: " + e);
        }
	});

	ws.on('close', (e) => {
		removeClient(ws);
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

function getClientById(id) {
	for (var i = 0; i < clients.length; i++)
		if (clients[i].id == id)
			return clients[i].client;
	return null;
}

function getIdByClient(ws) {
	for (var i = 0; i < clients.length; i++)
		if (clients[i].client == ws)
			return clients[i].id;
	return null;
}

function removeClient(ws) {
	for (var i = 0; i < clients.length; i++)
		if (clients[i].client == ws) {
			clients.splice(i, 1);
			return;
		}
}

function sendToAll(eventObject) {
	for (var i = 0; i < clients.length; i++)
		sendEvent(eventObject, clients[i].client);
}

function sendEvent(eventObject, ws) {
	var str = JSON.stringify(eventObject);
	ws.send(str);
	console.log("Sent to " + getIdByClient(ws));
}

function parseEvent(eventObject, ws) {
	console.log("Got " + eventObject.Name);
	switch (eventObject.Name) {
		case "ListTeamsEvent":
			eventObject.Teams = teams;
			sendEvent(eventObject, ws);
			break;
		case "AddTeamEvent":
			var newTeam = { Name: eventObject.TeamName, CurrentMemberCount: 1, TotalMemberCount: 5 };
			teams.push(newTeam);
			sendToAll({ Name: "NewTeamEvent", Team: newTeam });
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