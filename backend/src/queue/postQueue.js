const { Queue } = require('bullmq')
const connection = require('./connection')

const postQueue = new Queue('posts', {
  connection
})

module.exports = postQueue