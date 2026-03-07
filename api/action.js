module.exports = (req, res) => {
  res.status(200).json({
    message: 'Bot action endpoint',
    status: 'ok'
  });
};