const { listen } = require('../../_shared/http-app');
const { createApp } = require('./app');

listen(createApp(), 'notification-service', 8080);