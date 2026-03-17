const BCA_ACCOUNT = { name: 'Nathasya Vira Nerisa', number: '2950211345', bank: 'BCA' };

async function chargeGateway({ orderNumber, amount }) {
  return {
    gateway: 'manual',
    gatewayPaymentId: null,
    gatewayBillingNo: null,
    gatewayResponse: { ...BCA_ACCOUNT, order_number: orderNumber, amount },
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

module.exports = { chargeGateway };