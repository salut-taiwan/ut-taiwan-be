'use strict';

/**
 * Forward a rejected async handler to Express's error middleware.
 *
 * Express 4 does not catch rejections from async handlers: an unhandled one
 * sends no response at all — the client hangs until its socket times out — and
 * under Node's default --unhandled-rejections=throw it terminates the process.
 * Several handlers (checkout, cancelOrder, confirmPayment, the upload routes,
 * and the auth handlers) have no try/catch of their own, so one transient
 * database blip could take the server down.
 *
 * Wrapping them routes the rejection to the handler in app.js, which answers
 * 500 { error } instead.
 *
 * @param {Function} fn async (req, res, next) => any
 * @returns {Function} an Express handler that never rejects
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
