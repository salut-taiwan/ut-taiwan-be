const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(500);

function emitUserStatusUpdate(userId, payload) {
  bus.emit(`user:${userId}`, payload);
}

function subscribeUserStatus(userId, cb) {
  bus.on(`user:${userId}`, cb);
  return () => bus.off(`user:${userId}`, cb);
}

module.exports = { emitUserStatusUpdate, subscribeUserStatus };
