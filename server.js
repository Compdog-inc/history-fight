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

function getThemes(page) {
	var result = [];
	result.push({
		id: "demo228",
		display: "Demo Theme",
		description: "This is a demo theme. Soon we will add user themes.",
		modtime: 1619723905190,
		views: 782,
		rating: 4.69228
	});
	return result;
}

function getThemeInfo(id) {
	if (id == "demo228") {
		return {
			id: "demo228",
			display: "Demo Theme",
			description: "This is a demo theme. Soon we will add user themes.",
			modtime: 1619723905190,
			views: 782,
			rating: 4.69228
		};
	}
	return null;
}

function getThemeQuestion(id, index) {
	if (id == "demo228") {
		switch (index) {
			case 0:
				return {
					question: "2 + 2 = ?",
					answer: 3,
					answers: ["Хомяк", "2", "7", "4"],
					timeGiven: 10
				};
			case 1:
				return {
					question: "Когда появилась Земля?",
					answer: 2,
					answers: ["XIIв. до Н.Э.", "Вчера", "Давно", "Что такое Земля?"],
					timeGiven: 15
				};
			case 2:
				return {
					question: "Сколько хвостов у кота?",
					answer: 0,
					answers: ["1", "5", "3", "Нету"],
					timeGiven: 10
				};
			case 3:
				return {
					question: "Placeholder",
					answer: 2,
					answers: ["Hmm", "No", "Correct", "Hello"],
					timeGiven: 10
				};
			case 4:
				return {
					question: "В каком году хомяк схомячил еду?",
					answer: 1,
					answers: ["1999", "2021", "2070", "0001"],
					timeGiven: 20
				};
			case 5:
				return {
					question: "Как далеко северный полюс?",
					answer: 3,
					answers: ["5 км", "Я уже там", "-50 км", "Далеко"],
					timeGiven: 10
				};
        }
	}
	return null;
}

app.get("/themes/get", function (req, res) {
	if (req.query.page) {
		if (!isNaN(req.query.page)) {
			var page = parseInt(req.query.page);
			if (!isNaN(page) && page >= 0) {
				var pageCount = 0;
				if (page <= pageCount) {
					res.status(200).send({ page: page, end: page == pageCount, themes: getThemes(page) });
					return;
				}
			}
		}
		res.status(400).send("Bad Request! Make sure page is a valid number.");	
	} else
		res.status(400).send("Bad Request! Make sure you have 'page' in url.");
});

app.get("*", function (req, res) {
	res.send(`<!DOCTYPE html>
<html>
<head>
	<title>History Fight</title>
</head>
<body>
	<p>Oh hi! Didn't think you would come here... Here's a super cool <a href="http://www.compdog.ga">website</a>!</p>
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
				if (room.currentVoteTimeout != null)
					clearTimeout(room.currentVoteTimeout);
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

		var client = { client: ws, id: id, inTeam: false, shouldClose: false, currentQuestion: null, questionAnsweredTime: 0, questionAnsweredCorrect: false };
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

function randomInt(min, max) {
	return Math.floor(Math.random() * (max - min)) + min;
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
	return room.teams.length > 1 && room.teams.length <= room.settings.maxTeams;
}

function sendToAll(eventObject, room) {
	if (room == null)
		return;
	for (var i = 0; i < room.clients.length; i++)
		sendEvent(eventObject, room.clients[i].client, room);
}

function sendToAllAlive(eventObject, room) {
	if (room == null)
		return;
	for (var i = 0; i < room.teams.length; i++)
		if (!room.teams[i].IsDead) sendToTeam(eventObject, room, room.teams[i]);
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
	// Reset prev round
	for (var i = 0; i < room.teams.length; i++) {
		room.teams[i].BeforeHealth = room.teams[i].HP;
	}

	for (var i = 0; i < room.teams.length; i++) {
		if (room.settings.randomizeQuestionsInsideTeam) {
			for (var j = 0; j < room.teams[i].Players.length; j++) {
				var question = getThemeQuestion(room.settings.theme, randomInt(0, 5));
				var player = getPlayerById(room.teams[i].Players[j], room);
				player.currentQuestion = {
					question: question.question,
					answer: question.answer,
					timeGiven: 10,
					timeStart: Date.now()
				};
				sendEvent({
					Name: "QuestionEvent",
					SentInfo: false,
					TimeLeft: 10,
					Question: question.question,
					Answers: question.answers
				}, player.client, room);
			}
		} else {
			var question = getThemeQuestion(room.settings.theme, randomInt(0, 5));
			var q = {
				question: question.question,
				answer: question.answer,
				timeGiven: 10,
				timeStart: Date.now()
			};
			for (var j = 0; j < room.teams[i].Players.length; j++) {
				var player = getPlayerById(room.teams[i].Players[j], room);
				player.currentQuestion = q;
				sendEvent({
					Name: "QuestionEvent",
					SentInfo: false,
					TimeLeft: 10,
					Question: question.question,
					Answers: question.answers
				}, player.client, room);
			}
		}
	}
	room.currentQuestionTimeout = setTimeout(() => questionTimeUp(room), 10 * 1000);
}

function questionTimeUp(room) {
	var correctPlayers = [];
	for (var i = 0; i < room.clients.length; i++) {
		var client = room.clients[i];
		var timeSpent = -1;
		if (client.questionAnsweredTime > 0) {
			timeSpent = Math.floor((client.questionAnsweredTime - client.currentQuestion.timeStart) / 1000);
		}
		if (client.questionAnsweredCorrect) {
			var t = getTeamByClientId(client.id, room);
			if (t != null) {
				t.CorrectPlayers++;
				t.XP += (1 - timeSpent / 10) * 10;
			}
			correctPlayers.push(client);
		}
		var event = { Name: "QuestionEvent", SentInfo: true, IsCorrect: client.questionAnsweredCorrect, TimeLeft: 3 };
		sendEvent(event, client.client, room);
		client.questionAnsweredTime = 0;
		client.questionAnsweredCorrect = false;
		client.currentQuestion = null;
	}

	room.currentQuestionTimeout = null;
	room.currentQuestion = null;

	room.currentVoteTimeout = setTimeout(() => randomVoting(room, correctPlayers), 3000);
}

function getRandomTeam(room, ignoreTeamId) {
	var teamIndex = randomInt(0, room.teams.length);
	if (room.teams[teamIndex].IsDead || room.teams[teamIndex].Uuid === ignoreTeamId)
		return getRandomTeam(room, ignoreTeamId);
	return room.teams[teamIndex];
}

function randomVoting(room, correctPlayers) {
	var teamsKilled = 0;
	var teamsAttacked = 0;
	var teamsHurt = 0;

	for (var i = 0; i < room.teams.length; i++) {
		var team = room.teams[i];
		if (team != null && !team.IsDead) {
			if (team.CorrectPlayers > 0) {
				teamsAttacked++;
				for (var j = 0; j < team.CorrectPlayers; j++) {
					var t = getRandomTeam(room, team);
					t.HP -= team.CorrectPlayers / team.CurrentMemberCount * Math.ceil(room.settings.maxTeamHP / 20);
					teamsHurt++;
					if (t.HP <= 0) {
						t.HP = 0;
						t.IsDead = true;
						teamsKilled++;
					}
				}
			}
		}
	}

	for (var i = 0; i < correctPlayers.length; i++) {
		var team = getTeamByClientId(correctPlayers[i].id, room);
		if (team != null && !team.IsDead) {
			team.HP++;
			if (team.HP > room.settings.maxTeamHP) team.HP = room.settings.maxTeamHP;
		}
	}

	room.teamsAlive = 0;

	for (var i = 0; i < room.teams.length; i++) {
		if (!room.teams[i].IsDead) room.teamsAlive++;
		var prevHealth = room.teams[i].BeforeHealth - room.teams[i].HP;
		sendToTeam({
			Name: "AttacksInfoEvent",
			TeamsKilled: teamsKilled,
			TeamsAttacked: teamsAttacked,
			HurtDamage: prevHealth,
			Killed: room.teams[i].IsDead
		}, room, room.teams[i]);
		sendToTeam({
			Name: "TeamStatusChangeEvent",
			teamInfo: {
				greenValue: room.teams[i].HP / room.settings.maxTeamHP,
				limeValue: room.teams[i].HP / room.settings.maxTeamHP,
				orangeValue: prevHealth / room.settings.maxTeamHP,
				XP: room.teams[i].XP,
				Rank: room.teams[i].Rank
			}
		}, room, room.teams[i]);
	}

	var teams = [];

	for (var i = 0; i < room.teams.length; i++) {
		teams.push(room.teams[i]);
	}

	teams.sort((a, b) => (a.XP > b.XP) ? -1 : ((b.XP > a.XP) ? 1 : 0));

	for (var i = 0; i < teams.length; i++) {
		teams[i].Rank = (i+1);
	}

	sendToServer({
		Name: "StatsUpdateEvent",
		Teams: teams,
		TeamsKilled: teamsKilled,
		TeamsAttacked: teamsAttacked,
		TeamsHurted: teamsHurt
	}, room);

	room.currentVoteTimeout = null;

	if (room.teamsAlive > 1)
		setTimeout(() => sendNewQuestion(room), 3000);
	else setTimeout(() => endGame(room), 3000);
}

function endGame(room) {
	var winners = ["?", "?", "?"];

	var teams = [];

	for (var i = 0; i < room.teams.length; i++) {
		teams.push(room.teams[i]);
	}

	teams.sort((a, b) => (a.XP > b.XP) ? -1 : ((b.XP > a.XP) ? 1 : 0));

	for (var i = 0; i < teams.length && i < 3; i++) {
		winners[i] = teams[i].Name;
    }

	sendToServer({
		Name: "GameEndEvent",
		Winners: winners
	}, room);

	for (var i = 0; i < room.teams.length; i++) {
		sendToTeam({
			Name: "GameEndEvent",
			TeamRank: room.teams[i].Rank
		}, room, room.teams[i]);
	}

	for (var i = 0; i < room.teams.length; i++) {
		room.teams[i].CorrectPlayers = 0;
    }
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
				var newTeam = { Uuid: generateId(), Name: eventObject.TeamName, CurrentMemberCount: 1, TotalMemberCount: room.settings.maxPlayers, Players: [getIdByClient(ws, room)], HP: room.settings.maxTeamHP, BeforeHealth: room.settings.maxTeamHP, XP: 0, Rank: 0, IsDead: false, CorrectPlayers: 0 };
				room.teams.push(newTeam);
				var ev = { Name: "NewTeamEvent", Team: newTeam, MaxTeams: room.settings.maxTeams };
				sendToAll(ev, room);
				sendToServer(ev, room);
			} else
				ws.send(INT_RESPONSE_INVALID);
			break;
		case "NewRoomEvent":
			if (eventObject.settings.theme != "") {
				var rmCode = generateRoomCode();
				room = {
					code: rmCode,
					teams: [],
					clients: [],
					server: ws,
					teamsAlive: 0,
					started: false,
					currentQuestionTimeout: null,
					currentVoteTimeout: null,
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
			} else
				ws.send(INT_RESPONSE_INVALID);
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
				room.teamsAlive = room.teams.length;
				sendToAll(eventObject, room);
				sendToServer({ Name: "GameStartEvent", Theme: getThemeInfo(room.settings.theme).display, Teams: room.teams }, room);
				sendToServer({
					Name: "StatsUpdateEvent",
					Teams: room.teams
				}, room);
				sendNewQuestion(room);
			} else
				ws.send(INT_RESPONSE_INVALID);
			break;
		case "QuestionEvent":
			if (room.started) {
				var player = getPlayerByClient(ws, room);
				if (player.currentQuestion != null) {
					if (player.questionAnsweredTime <= 0) {
						player.questionAnsweredTime = Date.now();
						player.questionAnsweredCorrect = eventObject.Answer === player.currentQuestion.answer;
					} else
						ws.send(INT_RESPONSE_INVALID);
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