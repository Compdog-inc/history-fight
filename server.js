process.on("uncaughtException", (e) => {
	console.log("Error: " + e.stack);
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

const INT_RESPONSE_OK				= "4000";	// When joining a existing room
const INT_RESPONSE_NOT_FOUND		= "4001";	// When trying to join a non-existing room
const INT_RESPONSE_INVALID			= "4002";	// When sending a command that is invalid at the current time
const INT_RESPONSE_STARTED			= "4003";	// When trying to join an already started game
const INT_RESPONSE_INTERNAL_ERROR	= "4004";	// When command caused an internal server error
const INT_RESPONSE_ECHO				= "0";		// Debug response

const CLOSE_REASON_UNKNOWN			= 0;
const CLOSE_REASON_TEAM_REMOVED		= 1;
const CLOSE_REASON_GAME_STARTED		= 2;

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const client = new Client({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		rejectUnauthorized: false
	}
});

var rooms = [];

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

		if (req.params.filename.endsWith(".jpg"))
			res.set('Content-Type', 'image/jpeg');

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
	var infoUrl = req.url.substr(1);
	if (infoUrl == "server") {
		console.log("New Connection (server) waiting for more information");

		ws.on('close', (e) => {
			var room = getRoomByServer(ws);
			if (room != null) {
				if (room.currentQuestion != null && room.currentQuestionTimeout != null)
					clearTimeout(room.currentQuestionTimeout);
				for (var i = 0; i < room.clients.length; i++)
					room.clients[i].client.close();
				rooms = rooms.filter(item => item !== room);
			}
			if (e.wasClean) {
				console.log(`Server connection closed cleanly, code=${event.code} reason=${event.reason}`);
			} else {
				console.log("Server connection died");
			}
		});

		ws.once('message', (message) => {
			try {
				var eventObject = JSON.parse(message);
				parseEvent(eventObject, ws, room);
			} catch (e) {
				console.error("Error parsing event: " + e.stack);
				ws.send(INT_RESPONSE_INTERNAL_ERROR);
			}
		});
	} else {
		var room = getRoomByCode(infoUrl);
		if (room == null) {
			ws.once('message', () => {
				ws.close();
			});

			ws.send(INT_RESPONSE_NOT_FOUND);
			return;
		} else if (room.started) {
			ws.once('message', () => {
				ws.close();
			});

			ws.send(INT_RESPONSE_STARTED);
			return;
        }

		var id = generateId();

		var client = { client: ws, id: id, inTeam: false, shouldClose: false, questionAnsweredTime: 0, questionAnsweredCorrect: false };
		room.clients.push(client);

		console.log(`New Connection '${id}' room '${room.code}'`);

		ws.send(INT_RESPONSE_OK);

		ws.on('close', (e) => {
			removeClient(ws, room);
			if (e.wasClean) {
				console.log(`Connection closed cleanly, code=${event.code} reason=${event.reason}`);
			} else {
				console.log("Connection died");
			}
		});

		ws.on('message', (message) => {
			try {
				if (client.shouldClose)
					return ws.close();
				var eventObject = JSON.parse(message);
				parseEvent(eventObject, ws, room);
			} catch (e) {
				console.error("Error parsing event: " + e.stack);
				ws.send(INT_RESPONSE_INTERNAL_ERROR);
			}
		});
	}
	ws.isAlive = true;
	ws.on('pong', () => {
		ws.isAlive = true;
	});
});

function generateId() {
	return uuidv4();
}

function generateNum(n) {
	var add = 1, max = 12 - add;

	if (n > max) {
		return generate(max) + generate(n - max);
	}

	max = Math.pow(10, n + add);
	var min = max / 10;
	var number = Math.floor(Math.random() * (max - min + 1)) + min;

	return ("" + number).substring(add);
}

function generateRoomCode() {
	var code = generateNum(6);

	if (getRoomByCode(code) != null)
		code = generateRoomCode();

	return code;
}

function getRoomByCode(code) {
	for (var i = 0; i < rooms.length; i++)
		if (rooms[i].code === code)
			return rooms[i];
	return null;
}

function getClientById(id, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].id === id)
			return room.clients[i].client;
	return null;
}

function getIdByClient(ws, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].client === ws)
			return room.clients[i].id;
	return null;
}

function getPlayerById(id, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].id === id)
			return room.clients[i];
	return null;
}

function getPlayerByClient(ws, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].client === ws)
			return room.clients[i];
	return null;
}

function getPlayerIndexById(id, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].id === id)
			return i;
	return null;
}

function getPlayerIndexByClient(ws, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].client === ws)
			return i;
	return null;
}

function getRoomByServer(server) {
	for (var i = 0; i < rooms.length; i++) {
		if (rooms[i].server == server)
			return rooms[i];
	}
	return null;
}

function removeClientIdInTeam(id, team) {
	if (team.Players.includes(id))
		team.Players = team.Players.filter(item => item !== id);
}

function getTeamByClientId(id, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.teams.length; i++)
		for (var j = 0; j < room.teams[i].Players.length; j++)
			if (room.teams[i].Players[j] === id)
				return room.teams[i];
	return null;
}

function getTeamById(id, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.teams.length; i++)
		if (room.teams[i].Uuid === id)
			return room.teams[i];
	return null;
}

function removeClient(ws, room) {
	if (room == null)
		return;
	var clientId = getIdByClient(ws, room);
	var clientTeam = getTeamByClientId(clientId, room);
	if (clientTeam != null) {
		removeClientIdInTeam(clientId, clientTeam);

		for (var i = 0; i < room.clients.length; i++)
			if (room.clients[i].client == ws) {
				room.clients.splice(i, 1);
				break;
			}

		clientTeam.CurrentMemberCount--;
		var ev = { Name: "UpdateTeamEvent", Team: clientTeam };
		sendToAll(ev, room);
		sendToServer(ev, room);
	}
}

function terminateClient(id, room, reason) {
	terminateClientRaw(getPlayerById(id, room), room, reason);
}

function terminateClientRaw(player, room, reason) {
	if (room == null || player == null)
		return;
	player.shouldClose = true;
	if (reason)
		sendEvent({ Name: "CloseConnectionEvent", Reason: reason }, player.client, room);
	else
		player.client.close();

	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i] == player) {
			room.clients.splice(i, 1);
			return;
		}
}

function removeTeam(uuid, room) {
	for (var i = 0; i < room.teams.length; i++) {
		if (room.teams[i].Uuid === uuid) {
			for (var j = 0; j < room.teams[i].Players.length; j++)
				terminateClient(room.teams[i].Players[j], room, CLOSE_REASON_TEAM_REMOVED);
			room.teams.splice(i, 1);
			break;
        }
    }
}

function IsRoomValid(room) {
	return room.teams.length > 0 && room.teams.length <= room.settings.maxTeams;
}

function sendToAll(eventObject, room) {
	if (room == null)
		return;
	for (var i = 0; i < room.clients.length; i++)
		sendEvent(eventObject, room.clients[i].client, room);
}

function sendToServer(eventObject, room) {
	if (room == null)
		return;
	sendEvent(eventObject, room.server, room);
}

function sendToTeam(eventObject, room, team) {
	for (var i = 0; i < team.Players.length; i++)
		sendEvent(eventObject, getClientById(team.Players[i], room), room);
}

function sendEvent(eventObject, ws, room) {
	var str = JSON.stringify(eventObject);
	ws.send(str);
	var id = getIdByClient(ws, room);
	if (id == null)
		console.log("Sent to server (null)");
	else
		console.log("Sent to " + id);
}

function sendNewQuestion(room) {
	var question = "When Hom hom?";
	var answer = 1;
	var timeGiven = 20;
	room.currentQuestion = {
		question: question,
		answer: answer,
		timeGiven: timeGiven,
		timeStart: Date.now()
	};
	sendToAll({ Name: "QuestionEvent", SentInfo: false, TimeLeft: timeGiven, Question: question, Answers: ["Today", "Yesterday", "1934", "1345"] }, room);
	room.currentQuestionTimeout = setTimeout(() => questionTimeUp(room), timeGiven * 1000);
}

function questionTimeUp(room) {
	for (var i = 0; i < room.clients.length; i++) {
		var client = room.clients[i];
		var timeSpent = -1;
		if (client.questionAnsweredTime > 0) {
			timeSpent = Math.floor((client.questionAnsweredTime - room.currentQuestion.timeStart) / 1000);
			console.log("Client '" + client.id + "' answered in " + timeSpent + " seconds");
		} else {
			console.log("Client '" + client.id + "' didn't answer.");
        }
		var event = { Name: "QuestionEvent", SentInfo: true, IsCorrect: client.questionAnsweredCorrect };
		sendEvent(event, client.client, room);
		client.questionAnsweredTime = 0;
		client.questionAnsweredCorrect = false;
    }
	room.currentQuestionTimeout = null;
	room.currentQuestion = null;
}

function parseEvent(eventObject, ws, room) {
	console.log("Got " + eventObject.Name);
	switch (eventObject.Name) {
		case "ListTeamsEvent":
			eventObject.Teams = room.teams;
			eventObject.MaxTeams = room.settings.maxTeams;
			sendEvent(eventObject, ws, room);
			break;
		case "AddTeamEvent":
			var player = getPlayerByClient(ws, room);
			if (!room.started && player != null && !player.inTeam && room.teams.length < room.settings.maxTeams) {
				player.inTeam = true;
				var newTeam = { Uuid: generateId(), Name: eventObject.TeamName, CurrentMemberCount: 1, TotalMemberCount: room.settings.maxPlayers, Players: [getIdByClient(ws, room)] };
				room.teams.push(newTeam);
				var ev = { Name: "NewTeamEvent", Team: newTeam, MaxTeams: room.settings.maxTeams };
				sendToAll(ev, room);
				sendToServer(ev, room);
			} else
				ws.send(INT_RESPONSE_INVALID);
			break;
		case "NewRoomEvent":
			var rmCode = generateRoomCode();
			room = {
				code: rmCode,
				teams: [],
				clients: [],
				server: ws,
				started: false,
				currentQuestion: null,
				currentQuestionTimeout: null,
				settings: eventObject.settings
			};
			ws.on('message', (message) => {
				try {
					var eventObject = JSON.parse(message);
					parseEvent(eventObject, ws, room);
				} catch (e) {
					console.error("Error parsing event: " + e.stack);
					ws.send(INT_RESPONSE_INTERNAL_ERROR);
				}
			});
			rooms.push(room);
			eventObject.code = rmCode;
			sendEvent(eventObject, ws, room);
			break;
		case "RemoveTeamEvent":
			if (!room.started) {
				removeTeam(eventObject.Uuid, room);
				sendToAll(eventObject, room);
				sendToServer(eventObject, room);
			} else
				ws.send(INT_RESPONSE_INVALID);
			break;
		case "JoinTeamEvent":
			var player = getPlayerByClient(ws, room);
			if (!room.started && player != null && !player.inTeam) {
				player.inTeam = true;
				var team = getTeamById(eventObject.Uuid, room);
				if (team != null && team.CurrentMemberCount < team.TotalMemberCount) {
					team.Players.push(getIdByClient(ws, room));
					team.CurrentMemberCount++;
					var ev = { Name: "UpdateTeamEvent", Team: team, MaxTeams: room.settings.maxTeams };
					sendToAll(ev, room);
					sendToServer(ev, room);
				} else 
					ws.send(INT_RESPONSE_INVALID);
			} else 
				ws.send(INT_RESPONSE_INVALID);
			break;
		case "GameStartEvent":
			if (!room.started && IsRoomValid(room)) {
				room.started = true;
				for (var i = 0; i < room.clients.length; i++)
					if (!room.clients[i].inTeam) terminateClientRaw(room.clients[i], room, CLOSE_REASON_GAME_STARTED);
				sendToAll(eventObject, room);
				sendNewQuestion(room);
			} else
				ws.send(INT_RESPONSE_INVALID);
			break;
		case "QuestionEvent":
			if (room.started && room.currentQuestion != null) {
				var player = getPlayerByClient(ws, room);
				if (player.questionAnsweredTime <= 0) {
					player.questionAnsweredTime = Date.now();
					player.questionAnsweredCorrect = eventObject.answer === room.currentQuestion.answer;
				} else
					ws.send(INT_RESPONSE_INVALID);
			} else
				ws.send(INT_RESPONSE_INVALID);
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