module.exports = (req, res) => {
  res.status(200).json({
    name: 'Threads Reply Bot API',
    version: '1.0',
    endpoints: ['/api/action']
  });
};