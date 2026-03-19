const { PAYMENT_EXPIRY_MS } = require('../config/constants');

const BCA_ACCOUNT = { name: 'Nathasya Vira Nerisa', number: '2950211345', bank: 'BCA' };

async function chargeGateway({ orderNumber, amount }) {
  return {
    gateway: 'manual',
    gatewayPaymentId: null,
    gatewayBillingNo: null,
    gatewayResponse: { ...BCA_ACCOUNT, order_number: orderNumber, amount },
    expiresAt: new Date(Date.now() + PAYMENT_EXPIRY_MS).toISOString(),
  };
}

module.exports = { chargeGateway };
