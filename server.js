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

/**When joining a existing room*/
const INT_RESPONSE_OK = "4000";
/**When trying to join a non-existing room*/
const INT_RESPONSE_NOT_FOUND = "4001";
/**When sending a command that is invalid at the current time*/
const INT_RESPONSE_INVALID = "4002";
/**When trying to join an already started game*/
const INT_RESPONSE_STARTED = "4003";
/**When command caused an internal server error*/
const INT_RESPONSE_INTERNAL_ERROR = "4004";
/**Debug response*/
const INT_RESPONSE_ECHO = "0";

const CLOSE_REASON_UNKNOWN			= 0;
const CLOSE_REASON_TEAM_REMOVED		= 1;
const CLOSE_REASON_GAME_STARTED		= 2;

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const pclient = new Client({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		rejectUnauthorized: false
	}
});

/**A team of players*/
class Team {

};

/**A player*/
class Player {

};

/**Settings that get sent along the GameStartEvent*/
class RoomSettings {

};

/**A user theme*/
class Theme {

};

/**A user theme question*/
class ThemeQuestion {

};

/**A room that hosts a game*/
class Room {

	/**
	 * @param {Number} code
	 * @param {WebSocket} server
	 * @param {RoomSettings} settings
	 */
	constructor(code, server, settings) {
		this.code = code;
		this.teams = [];
		this.clients = [];
		this.server = server;
		this.teamsAlive = 0;
		this.started = false;
		this.currentQuestionTimeout = null;
		this.currentVoteTimeout = null;
		this.settings = settings;
		this.questionCount = 0;
		this.globalTime = 0;
	}

	/**
	 * The code of the room
	 * @type {Number}
	 */
	get code() {
		return this._code;
	}

	set code(value) {
		this._code = value;
	}

	/**
	 * The teams in the room
	 * @type {Team[]}
	 */
	get teams() {
		return this._teams;
	}

	set teams(value) {
		this._teams = value;
	}

	/**
	 * The clients in the room
	 * @type {Player[]}
	 */
	get clients() {
		return this._clients;
	}

	set clients(value) {
		this._clients = value;
	}

	/**
	 * The server socket
	 * @type {WebSocket}
	 */
	get server() {
		return this._server;
	}

	set server(value) {
		this._server = value;
	}

	/**
	 * Number of teams alive in the room
	 * @type {Number}
	 */
	get teamsAlive() {
		return this._teamsAlive;
	}

	set teamsAlive(value) {
		this._teamsAlive = value;
	}

	/**
	 * Is the game started
	 * @type {Boolean}
	 */
	get started() {
		return this._started;
	}

	set started(value) {
		this._started = value;
	}

	/**
	 * The current question timeout code
	 * @type {Number|null}
	 */
	get currentQuestionTimeout() {
		return this._currentQuestionTimeout;
	}

	set currentQuestionTimeout(value) {
		this._currentQuestionTimeout = value;
	}

	/**
	 * The current vote timeout code
	 * @type {Number|null}
	 */
	get currentVoteTimeout() {
		return this._currentVoteTimeout;
	}

	set currentVoteTimeout(value) {
		this._currentVoteTimeout = value;
	}

	/**
	 * The current settings of the room
	 * @type {RoomSettings}
	 */
	get settings() {
		return this._settings;
	}

	set settings(value) {
		this._settings = value;
	}

	/**
	 * The number of questions in current theme
	 * @type {Number}
	 */
	get questionCount() {
		return this._questionCount;
	}

	set questionCount(value) {
		this._questionCount = value;
	}

	/**
	 * The global question time in current theme
	 * @type {Number}
	 */
	get globalTime() {
		return this._globalTime;
	}

	set globalTime(value) {
		this._globalTime = value;
	}
};

/**
 * The rooms
 * @type {Room[]}
 */
var rooms = [];

app.use(cors());
app.set('trust proxy', true);

var jsonParser = bodyParser.json();
var urlencodedParser = bodyParser.urlencoded({
	extended: false
});

/**
 * Returns true if str ends with any of endings
 * @param {string} str
 * @param {string[]} endings
 * @returns {boolean}
 */
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

/**
 * Gets themes array with page
 * @param {Number} page the page to get
 * @returns {Promise<Theme[]>} the promise that has the themes
 */
function getThemes(page) {
	return new Promise((resolve, reject) => {
		/**@type {Theme[]}*/
		var result = [];
		pclient.query('SELECT * FROM public."user-themes"', (err, res) => {
			if (err) { console.log("Error getting themes: " + err); reject(err); return; }
			for (let row of res.rows) {
				result.push(row);
			}
			resolve(result);
		});
	});
}

/**
 * Gets single theme by its id
 * @param {string} id the id of the theme
 * @returns {Promise<Theme|null>} the promise that has the theme
 */
function getThemeInfo(id) {
	return new Promise((resolve, reject) => {
		pclient.query('SELECT * FROM public."user-themes" WHERE id = ?', [id], (err, res) => {
			if (err) { console.log("Error getting theme: " + err); reject(err); return; }
			if (res.rows.length > 0)
				resolve(res.rows[0]);
			else
				resolve(null);
		});
	});
}

/**
 * Gets theme questions by its id
 * @param {string} id the themes id
 * @param {Number} index the index of the question
 * @returns {Promise<ThemeQuestion|null>} the promise that has the theme question
 */
function getThemeQuestion(id, index) {
	return new Promise((resolve, reject) => {
		pclient.query('SELECT * FROM public."theme-game" WHERE id = ?', [id], (err, res) => {
			if (err) { console.log("Error getting theme question: " + err); reject(err); return; }
			if (res.rows.length > 0) {
				var questions = res.rows[0].questions;
				if (questions.length > 0 && index < questions.length) {
					resolve(JSON.parse(questions[index]));
				}
				else
					resolve(null);
			}
			else
				resolve(null);
		});
	});
}

app.get("/themes/get", function (req, res) {
	if (req.query.page) {
		if (!isNaN(req.query.page)) {
			var page = parseInt(req.query.page);
			if (!isNaN(page) && page >= 0) {
				var pageCount = 0;
				if (page <= pageCount) {
					getThemes(page).then((themes) => {
						res.status(200).send({ page: page, end: page == pageCount, themes: themes });
					}).catch((err) => {
						res.status(500).send("Internal Server Error! (Check the logs)");	
					});
					return;
				}
			}
		}
		res.status(400).send("Bad Request! Make sure page is a valid number.");	
	} else
		res.status(400).send("Bad Request! Make sure you have 'page' in url.");
});

app.post("/themes/create", jsonParser, function (req, res) {
	if (req.body && req.body.auth) {
		res.status(200).send({ id: 'hom' });
	} else
		res.status(400).send("Bad Request! Please send a valid auth code.");
});

app.post("/themes/edit", jsonParser, function (req, res) {
	if (req.body && req.body.id) {
		if (req.body.auth) {
			res.status(200).send("OK");
		} else
			res.status(401).send("Unauthorized! Auth Code invalid.");
	} else
		res.status(400).send("Bad Request! Make sure you sent a valid id.");
});

app.get("/themes/info", function (req, res) {
	if (req.query.id) {
		getThemeInfo(req.query.id.toString()).then((theme) => {
			res.status(200).send(theme);
		}).catch((err) => {
			res.status(400).send("Bad Request! Make sure you sent a valid id.");
		});
	} else
		res.status(400).send("Bad Request! Make sure you sent a valid id.");
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

/**
 * Generates a random id
 * @returns {string} the id
 */
function generateId() {
	return uuidv4();
}

/**
 * Generates a random number
 * @param {Number} n the number of digits
 * @returns {Number} the random number
 */
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

/**
 * Generates a random number in a range
 * @param {Number} min the min number (inclusive)
 * @param {Number} max the max number (exclusive)
 * @returns {Number} the random number
 */
function randomInt(min, max) {
	return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Generates a random room code with 6 digits
 * @returns {Number} the room code
 */
function generateRoomCode() {
	var code = generateNum(6);

	if (getRoomByCode(code) != null)
		code = generateRoomCode();

	return code;
}

/**
 * Returns a room with code or null if none found
 * @param {Number} code the code of the room
 * @returns {Room|null} the room or null if none found
 */
function getRoomByCode(code) {
	for (var i = 0; i < rooms.length; i++)
		if (rooms[i].code === code)
			return rooms[i];
	return null;
}

/**
 * Gets a client by its id
 * @param {string} id the players id
 * @param {Room} room the players room
 * @returns {WebSocket|null} the client or null of none found
 */
function getClientById(id, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].id === id)
			return room.clients[i].client;
	return null;
}

/**
 * Gets the id of player by its client
 * @param {WebSocket} ws the players client
 * @param {Room} room the players room
 * @returns {string|null} the id or null of none found
 */
function getIdByClient(ws, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].client === ws)
			return room.clients[i].id;
	return null;
}

/**
 * Gets the player by its id
 * @param {string} id the players id
 * @param {Room} room the players room
 * @returns {Player|null} the player or null of none found
 */
function getPlayerById(id, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].id === id)
			return room.clients[i];
	return null;
}

/**
 * Gets the player by its client
 * @param {WebSocket} ws the players client
 * @param {Room} room the players room
 * @returns {Player|null} the player or null of none found
 */
function getPlayerByClient(ws, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].client === ws)
			return room.clients[i];
	return null;
}

/**
 * Gets the player index by its id
 * @param {string} id the players id
 * @param {Room} room the players room
 * @returns {Number|null} the index or null if none found
 */
function getPlayerIndexById(id, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].id === id)
			return i;
	return null;
}

/**
 * Gets the play index by its client
 * @param {WebSocket} ws the players client
 * @param {Room} room the players room
 * @returns {Number|null} the index or null if none found
 */
function getPlayerIndexByClient(ws, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.clients.length; i++)
		if (room.clients[i].client === ws)
			return i;
	return null;
}

/**
 * Gets the room by its server
 * @param {WebSocket} server the rooms server
 * @returns {Room|null} the room or null if none found
 */
function getRoomByServer(server) {
	for (var i = 0; i < rooms.length; i++) {
		if (rooms[i].server == server)
			return rooms[i];
	}
	return null;
}

/**
 * Removes player by its id in a team
 * @param {string} id the players id
 * @param {Team} team the players team
 */
function removeClientIdInTeam(id, team) {
	if (team.Players.includes(id))
		team.Players = team.Players.filter(item => item !== id);
}

/**
 * Gets the team by one if its clients ids
 * @param {string} id one of the clients ids
 * @param {Room} room the teams room
 * @returns {Team|null} the team or null if none found
 */
function getTeamByClientId(id, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.teams.length; i++)
		for (var j = 0; j < room.teams[i].Players.length; j++)
			if (room.teams[i].Players[j] === id)
				return room.teams[i];
	return null;
}

/**
 * Gets team by its id
 * @param {string} id the teams id
 * @param {Room} room the teams room
 * @returns {Team|null} the team or null if none found
 */
function getTeamById(id, room) {
	if (room == null)
		return null;
	for (var i = 0; i < room.teams.length; i++)
		if (room.teams[i].Uuid === id)
			return room.teams[i];
	return null;
}

/**
 * Removes client from game and sends event
 * @param {WebSocket} ws the client
 * @param {Room} room the clients room
 */
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

/**
 * Terminates the connection to player by its id
 * @param {string} id the players id
 * @param {Room} room the players room
 * @param {Number} reason the reason for termination
 */
function terminateClient(id, room, reason) {
	terminateClientRaw(getPlayerById(id, room), room, reason);
}

/**
 * Terminates the connection to player and sends event
 * @param {Player} player the player
 * @param {Room} room the players room
 * @param {Number} reason the reason for termination
 */
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

/**
 * Removes team from game
 * @param {string} uuid the teams id
 * @param {Room} room the teams room
 */
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

/**
 * Returns true if the room is valid for starting game
 * @param {Room} room the room
 * @returns {Boolean} valid
 */
function IsRoomValid(room) {
	return room.teams.length > 1 && room.teams.length <= room.settings.maxTeams;
}

/**
 * Sends event to all clients in room
 * @param {any} eventObject the event
 * @param {Room} room the room
 */
function sendToAll(eventObject, room) {
	if (room == null)
		return;
	for (var i = 0; i < room.clients.length; i++)
		sendEvent(eventObject, room.clients[i].client, room);
}

/**
 * Sends event to all alive in room
 * @param {any} eventObject the event
 * @param {Room} room the room
 */
function sendToAllAlive(eventObject, room) {
	if (room == null)
		return;
	for (var i = 0; i < room.teams.length; i++)
		if (!room.teams[i].IsDead) sendToTeam(eventObject, room, room.teams[i]);
}

/**
 * Sends event to server in room
 * @param {any} eventObject the event
 * @param {Room} room the room
 */
function sendToServer(eventObject, room) {
	if (room == null)
		return;
	sendEvent(eventObject, room.server, room);
}

/**
 * Sends event to all players in team
 * @param {any} eventObject the event
 * @param {Room} room the room
 * @param {Team} team the team
 */
function sendToTeam(eventObject, room, team) {
	for (var i = 0; i < team.Players.length; i++)
		sendEvent(eventObject, getClientById(team.Players[i], room), room);
}

/**
 * Sends event to client
 * @param {any} eventObject the event
 * @param {WebSocket} ws the client
 * @param {Room} room the room
 */
function sendEvent(eventObject, ws, room) {
	var str = JSON.stringify(eventObject);
	ws.send(str);
	var id = getIdByClient(ws, room);
	if (id == null)
		console.log("Sent to server (null)");
	else
		console.log("Sent to " + id);
}

/**
 * Sends a new question to a room
 * @param {Room} room the room
 */
function sendNewQuestion(room) {
	// Reset prev round
	for (var i = 0; i < room.teams.length; i++) {
		room.teams[i].BeforeHealth = room.teams[i].HP;
		room.teams[i].CorrectPlayers = 0;
	}

	for (var i = 0; i < room.teams.length; i++) {
		if (room.settings.randomizeQuestionsInsideTeam) {
			for (var j = 0; j < room.teams[i].Players.length; j++) {
				(function () {
					var id = room.teams[i].Players[j];
					getThemeQuestion(room.settings.theme, randomInt(0, room.questionCount)).then((question) => {
						var player = getPlayerById(id, room);
						player.currentQuestion = {
							question: question.question,
							answer: question.answer,
							timeGiven: room.globalTime,
							timeStart: Date.now()
						};
						sendEvent({
							Name: "QuestionEvent",
							SentInfo: false,
							TimeLeft: room.globalTime,
							GlobalTimeLeft: room.globalTime,
							Question: question.question,
							Answers: question.answers,
							AnswerType: question.answerType,
							QuestionImageUrl: question.questionImageUrl
						}, player.client, room);

						if (room.currentQuestionTimeout == null)
							room.currentQuestionTimeout = setTimeout(() => questionTimeUp(room), room.globalTime * 1000);
					}).catch((err) => { });
				})();
			}
		} else {
			(function () {
				var tmpI = i;
				getThemeQuestion(room.settings.theme, randomInt(0, room.questionCount)).then((question) => {
					var q = {
						question: question.question,
						answer: question.answer,
						timeGiven: room.globalTime,
						timeStart: Date.now()
					};
					for (var j = 0; j < room.teams[i].Players.length; j++) {
						var player = getPlayerById(room.teams[tmpI].Players[j], room);
						player.currentQuestion = q;
						sendEvent({
							Name: "QuestionEvent",
							SentInfo: false,
							TimeLeft: room.globalTime,
							GlobalTimeLeft: room.globalTime,
							Question: question.question,
							Answers: question.answers,
							AnswerType: question.answerType,
							QuestionImageUrl: question.questionImageUrl
						}, player.client, room);
					}
					room.currentQuestionTimeout = setTimeout(() => questionTimeUp(room), room.globalTime * 1000);
				}).catch((err) => { });
			})();
		}
	}
}

/**
 * Calculates the points for a team
 * @param {Number} timeSpent the time spent answering
 * @param {Number} timeGiven the time given for question
 * @param {Number} min the min points
 * @param {Number} max the max points
 * @returns {Number} the points
 */
function calcPoints(timeSpent, timeGiven, min, max) {
	return (1 - timeSpent / timeGiven) * (max - min) + min;
}

/**
 * Gets called when question time is up
 * @param {Room} room the current room
 */
function questionTimeUp(room) {
	/**@type {Player[]}*/
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
				t.XP += calcPoints(timeSpent, 10, 1, 10);
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

	room.currentVoteTimeout = setTimeout(() => randomVoting(room, correctPlayers), 3000);
}

/**
 * Gets a random alive team and ignores an id
 * @param {Room} room the room
 * @param {string} ignoreTeamId the team id to ignore
 * @returns {Team|null} the team or null if none found / all dead
 */
function getRandomTeam(room, ignoreTeamId) {
	if (room.teamsAlive > 0) {
		var teamIndex = randomInt(0, room.teams.length);
		if (room.teams[teamIndex].IsDead || room.teams[teamIndex].Uuid === ignoreTeamId)
			return getRandomTeam(room, ignoreTeamId);
		return room.teams[teamIndex];
	} else
		return null;
}

/**
 * Does random voting
 * @param {Room} room the room
 * @param {Player[]} correctPlayers the players that answered correctly
 */
function randomVoting(room, correctPlayers) {
	var teamsKilled = 0;
	var teamsAttacked = 0;
	var teamsHurt = 0;

	room.teamsAlive = 0;
	for (var i = 0; i < room.teams.length; i++)
		if (!room.teams[i].IsDead) room.teamsAlive++;

	for (var i = 0; i < room.teams.length; i++) {
		var team = room.teams[i];
		if (team != null && !team.IsDead) {
			if (team.CorrectPlayers > 0) {
				teamsAttacked++;
				for (var j = 0; j < team.CorrectPlayers; j++) {
					var t = getRandomTeam(room, team.Uuid);
					if (t != null) {
						t.HP -= team.CorrectPlayers / team.CurrentMemberCount * Math.ceil(room.settings.maxTeamHP / 20);
						teamsHurt++;
						if (t.HP <= 0) {
							t.HP = 0;
							t.IsDead = true;
							room.teamsAlive--;
							teamsKilled++;
							break;
						}
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
		if (prevHealth < 0) prevHealth = 0;
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

/**
 * Ends the game
 * @param {Room} room the room
 */
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

/**
 * Does event parsing logic
 * @param {Object} eventObject the event
 * @param {string} eventObject.Name the event name
 * @param {WebSocket} ws the sender
 * @param {Room} room the current room
 */
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
				var room = new Room(generateRoomCode(), ws, eventObject.settings);
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
				eventObject.code = room.code;
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
				getThemeInfo(room.settings.theme).then((theme) => {
					room.questionCount = theme.questions;
					room.globalTime = theme.globaltime;
					sendToAll(eventObject, room);
					sendToServer({ Name: "GameStartEvent", Theme: theme.display, Teams: room.teams }, room);
					sendToServer({
						Name: "StatsUpdateEvent",
						Teams: room.teams
					}, room);
					setTimeout(() => sendNewQuestion(room), 3600);
				}).catch((err) => {
					sendToAll(eventObject, room);
					sendToServer({ Name: "GameStartEvent", Theme: room.settings.theme, Teams: room.teams }, room);
					sendToServer({
						Name: "StatsUpdateEvent",
						Teams: room.teams
					}, room);
					setTimeout(() => sendNewQuestion(room), 3600);
				});
			} else
				ws.send(INT_RESPONSE_INVALID);
			break;
		case "QuestionEvent":
			if (room.started) {
				var player = getPlayerByClient(ws, room);
				if (player.currentQuestion != null) {
					if (player.questionAnsweredTime <= 0) {
						player.questionAnsweredTime = Date.now();
						if(eventObject.Answer)
							player.questionAnsweredCorrect = eventObject.Answer.toString() == player.currentQuestion.answer.toString();
					} else
						ws.send(INT_RESPONSE_INVALID);
				} else 
					ws.send(INT_RESPONSE_INVALID);
			} else
				ws.send(INT_RESPONSE_INVALID);
			break;
	}
}

pclient.connect();

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