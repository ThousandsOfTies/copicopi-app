import 'dotenv/config'
import { createApp } from './app.js'

const port = Number(process.env.PORT || 3003)
createApp().listen(port, '0.0.0.0', () => {
  console.log(`CopiCopi API listening on port ${port}`)
})
