// api/index.js
const express = require("express");
const serverless = require("serverless-http");
const app = require("../../app"); // assuming `app.js` is at root level

module.exports = app;
module.exports.handler = serverless(app);
