const express = require("express");
const app = express();
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const { Client } = require('pg');
const http = require('http');
const WebSocket = require('ws');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const client = new Client({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		rejectUnauthorized: false
	}
});

var teams = [
	{ Name: "Homyak", CurrentMemberCount: 2, TotalMemberCount: 5 },
	{ Name: "Barbos TEAM", CurrentMemberCount: 4, TotalMemberCount: 5 },
	{ Name: "goose", CurrentMemberCount: 0, TotalMemberCount: 5 }
];

app.use(cors());
app.set('trust proxy', true);
app.use(express.static("public"));

var jsonParser = bodyParser.json();
var urlencodedParser = bodyParser.urlencoded({
	extended: false
});

app.get("/favicon.ico", function (req, res) {
	res.sendFile("favicon.ico", {
		root: path.join(__dirname, 'public'),
		headers: {
			'x-timestamp': Date.now(),
			'x-sent': true
		}
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
	console.log("new connection");
	ws.isAlive = true;

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
		if (e.wasClean) {
			console.log(`Connection closed cleanly, code=${event.code} reason=${event.reason}`);
		} else {
			console.log("Connection died");
		}
	});
});

function sendEvent(eventObject, ws) {
	var str = JSON.stringify(eventObject);
	console.log("Sending " + str);
	ws.send(str);
}

function parseEvent(eventObject, ws) {
	switch (eventObject.Name) {
		case "ListTeamsEvent":
			eventObject.Teams = teams;
			sendEvent(eventObject, ws);
			break;
		case "AddTeamEvent":
			var newTeam = { Name: eventObject.TeamName, CurrentMemberCount: 1, TotalMemberCount: 5 };
			teams.push(newTeam);
			sendEvent({ Name: "NewTeamEvent", Team: newTeam }, ws);
			break;
	}
}

client.connect();

server.listen(process.env.PORT || 3000,
	() => {
		setInterval(() => {
			wss.clients.forEach((ws) => {
				if (!ws.isAlive) {
					console.log("dead socket :(");
					return ws.terminate();
				}
				ws.isAlive = false;
				ws.ping(null, false, true);
			});
		}, 10000);
		console.log("Server Started.");
	});