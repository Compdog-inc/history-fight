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

app.use(cors());
app.set('trust proxy', true);
app.use(express.static("public"));

var jsonParser = bodyParser.json();
var urlencodedParser = bodyParser.urlencoded({
	extended: false
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

client.connect();

server.listen(process.env.PORT || 3000,
	() => {
		setInterval(() => {
			wss.clients.forEach((ws) => {
				if (!ws.isAlive) return ws.terminate();
				ws.isAlive = false;
				ws.ping(null, false, true);
			});
		}, 10000);
		console.log("Server Started.");
	});