const { getApp } = require('../src/app');

module.exports = async (req, res) => {
  const app = await getApp();
  return app(req, res);
};

