function getFees(req, res) {
  res.json({
    membershipFee: 650_000,
    serviceFees: [
      { label: 'Ongkir',      key: 'shipping', amount: 300_000 },
      { label: 'Biaya Box',   key: 'box',      amount: 100_000 },
      { label: 'Biaya Admin', key: 'admin',    amount:  25_000 },
    ],
    totalServiceFees: 425_000,
  });
}

module.exports = { getFees };
