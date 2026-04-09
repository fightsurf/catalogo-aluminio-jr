const path = require('path');

exports.page = (req, res) => {
  res.sendFile(path.join(__dirname, '../../../views/combinador/index.html'));
};
