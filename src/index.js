const express = require('express')
const bodyParser = require('body-parser')
const axios = require('axios')
const app = express()
const uuid = require('uuid')
const { uploadImage } = require('./image')
const Account = require('./account.js')
const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')
dotenv.config()
if ((!process.env.ACCOUNT_TOKENS && process.env.API_KEY) || (process.env.ACCOUNT_TOKENS && !process.env.API_KEY)) {
  console.log('如果需要使用多账户，请设置ACCOUNT_TOKENS和API_KEY')
  process.exit(1)
}

const accountTokens = process.env.ACCOUNT_TOKENS
let accountManager = null
let isSearch = false

if (accountTokens) {
  accountManager = new Account(accountTokens)
}

app.use(bodyParser.json({ limit: '128mb' }))
app.use(bodyParser.urlencoded({ limit: '128mb', extended: true }))

const isJson = (str) => {
  try {
    JSON.parse(str)
    return true
  } catch (error) {
    return false
  }
}

app.use((err, req, res, next) => {
  console.error(err)
})

app.get('/', async (req, res) => {
  try {
    let html = fs.readFileSync(path.join(__dirname, 'home.html'), 'utf-8')
    if (accountManager) {
      res.setHeader('Content-Type', 'text/html')
      html = html.replace('BASE_URL', `http://${process.env.LISTEN_ADDRESS ? process.env.LISTEN_ADDRESS : "localhost"}:${process.env.SERVICE_PORT ? process.env.SERVICE_PORT:''}${process.env.API_PREFIX ? process.env.API_PREFIX : ''}`)
      html = html.replace('RequestNumber', accountManager.getRequestNumber())
      html = html.replace('SuccessAccountNumber', accountManager.getAccountTokensNumber())
      html = html.replace('ErrorAccountNumber', accountManager.getErrorAccountTokensNumber())
      html = html.replace('ErrorAccountTokens', accountManager.getErrorAccountTokens().join('\n'))
    }
    res.send(html)
  } catch (e) {
    res.status(500)
      .json({
        error: "服务错误!!!"
      })
  }
})

app.get(`${process.env.API_PREFIX ? process.env.API_PREFIX : ''}/v1/models`, async (req, res) => {
  try {
    let authToken = req.headers.authorization

    if (authToken) {
      // 如果提供了 Authorization header，验证是否与 API_KEY 匹配
      if (authToken === `Bearer ${process.env.API_KEY}`) {
        authToken = accountManager.getAccountToken()
      }
    } else if (accountManager) {
      // 如果没有 Authorization header 且有账户管理，使用账户 token
      authToken = accountManager.getAccountToken()
    } else {
      res.json(await accountManager.getModelList())
      return
    }

    const response = await axios.get('https://chat.qwenlm.ai/api/models',
      {
        headers: {
          "Authorization": `Bearer ${authToken}`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:136.0) Gecko/20100101 Firefox/136.0"
        }
      })
    const modelsList_response = response.data.data
    const modelsList = []
    for (const item of modelsList_response) {
      if(item.id == 'qwen-max-latest' || item.id == 'qwen-plus-latest' || item.id == 'qwen2.5-14b-instruct-1m' || item.id == 'qwen-turbo-latest' || item.id == 'qwen2.5-72b-instruct'){
         modelsList.push(item.id+'-t2i')
         modelsList.push(item.id+'-t2v')
      }
      modelsList.push(item.id)
      modelsList.push(item.id + '-thinking')
      modelsList.push(item.id + '-search')
      modelsList.push(item.id + '-thinking-search')
    }
    const models = {
      "object": "list",
      "data": modelsList.map(item => ({
        "id": item,
        "object": "model",
        "created": new Date().getTime(),
        "owned_by": "qwenlm"
      })),
      "object": "list"
    }

    res.json(models)
  } catch (error) {
    res.json(await accountManager.getModelList())
    return
  }
})

app.post(`${process.env.API_PREFIX ? process.env.API_PREFIX : ''}/v1/chat/completions`, async (req, res) => {

  let authToken = req.headers.authorization
  if (!authToken) {
    return res.status(403)
      .json({
        error: "请提供正确的 Authorization token"
      })
  }

  if (authToken === `Bearer ${process.env.API_KEY}` && accountManager) {
    authToken = accountManager.getAccountToken()
  } else {
    authToken = authToken.replace('Bearer ', '')
  }

  console.log(`[${new Date().toLocaleString()}]: model: ${req.body.model} | stream: ${req.body.stream} | authToken: ${authToken.replace('Bearer ', '').slice(0, Math.floor(authToken.length / 2))}...`)

  const messages = req.body.messages
  let imageId = null
  const isImageMessage = Array.isArray(messages[messages.length - 1].content) === true && messages[messages.length - 1].content.filter(item => item.image_url && item.image_url.url).length > 0
  if (isImageMessage) {
    imageId = await uploadImage(messages[messages.length - 1].content.filter(item => item.image_url && item.image_url.url)[0].image_url.url, authToken)
    if (imageId) {
      messages[messages.length - 1].content[messages[messages.length - 1].content.length - 1] = {
        "type": "image",
        "image": imageId
      }
    }
  }

  if (req.body.stream === null || req.body.stream === undefined) {
    req.body.stream = false
  }
  const stream = req.body.stream

  const notStreamResponse = async (response,_id) => {
    try {
      if(isSearch){
        //非stream的请求待处理
        // _chat_response = await axios.post('https://chat.qwen.ai/api/v1/chats/'+_id,
        //   {
        //     "chat": {
        //           "models": ["qwen-max-latest"],
        //           "history": {},
        //           "messages": [],
        //           "params": {},
        //           "files": [],
        //           "chat_type": "search"
        //     },
        //     headers: {
        //      "Authorization": `Bearer ${authToken}`,
        //      "Host": "chat.qwen.ai",
        //      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0",
        //      "Connection": "keep-alive",
        //      "Accept": "*/*",
        //      "Accept-Encoding": "gzip, deflate, br, zstd",
        //      "Content-Type": "application/json",
        //      "x-request-id": `${uuid.v4()}`,
        //      "bx-umidtoken": process.env.BX_UMIDTOKEN,
        //      "sec-ch-ua": "\"Not(A:Brand\";v=\"99\", \"Microsoft Edge\";v=\"133\", \"Chromium\";v=\"133\"",
        //      "bx-ua": process.env.BX_UA,
        //      "sec-ch-ua-mobile": "?0",
        //      "sec-ch-ua-platform": "\"Windows\"",
        //      "bx-v": "2.5.28",
        //      "origin": "https://chat.qwen.ai",
        //      "sec-fetch-site": "same-origin",
        //      "sec-fetch-mode": "cors",
        //      "sec-fetch-dest": "empty",
        //      "referer": "https://chat.qwen.ai/",
        //      "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        //      "cookie": `${process.env.COOKIE.replace("`${authToken}`",authToken)}`,
        //      "priority": "u=1, i"
        //     },
        //     responseType: 'json'
        //   }
        // )
        // console.log(_chat_response.data)
      }
      const bodyTemplate = {
        "id": `chatcmpl-${uuid.v4()}`,
        "object": "chat.completion",
        "created": new Date().getTime(),
        "model": req.body.model,
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": response.choices[0].message.content
            },
            "finish_reason": "stop"
          }
        ],
        "usage": {
          "prompt_tokens": JSON.stringify(req.body.messages).length,
          "completion_tokens": response.choices[0].message.content.length,
          "total_tokens": JSON.stringify(req.body.messages).length + response.choices[0].message.content.length
        }
      }
      res.json(bodyTemplate)
    } catch (error) {
      console.log(error)
      res.status(500)
        .json({
          error: "服务错误!!!"
        })
    }
  }

  const streamResponse = async (response, thinkingEnabled) => {
    try {
      const id = uuid.v4()
      const decoder = new TextDecoder('utf-8')
      let backContent = null
      let webSearchInfo = null
      let temp_content = ''
      let thinkEnd = false

      response.on('data', async (chunk) => {
        const decodeText = decoder.decode(chunk, { stream: true })
        const lists = decodeText.split('\n').filter(item => item.trim() !== '')
        for (const item of lists) {
          try {
            let decodeJson = isJson(item.replace("data: ", '')) ? JSON.parse(item.replace("data: ", '')) : null
            if (decodeJson === null) {
              temp_content += item
              decodeJson = isJson(temp_content.replace("data: ", '')) ? JSON.parse(temp_content.replace("data: ", '')) : null
              if (decodeJson === null) {
                continue
              }
              temp_content = ''
            }

            // 处理 web_search 信息
            if (decodeJson.choices[0].delta.name === 'web_search') {
              webSearchInfo = decodeJson.choices[0].delta.extra.web_search_info
            }

            // 处理内容
            let content = decodeJson.choices[0].delta.content

            if (backContent !== null) {
              content = content.replace(backContent, '')
            }

            backContent = decodeJson.choices[0].delta.content

            if (thinkingEnabled && process.env.OUTPUT_THINK === "false" && !thinkEnd && !backContent.includes("</think>")) {
              continue
            } else if (thinkingEnabled && process.env.OUTPUT_THINK === "false" && !thinkEnd && backContent.includes("</think>")) {
              content = content.replace("</think>", "")
              thinkEnd = true
            }

            if (webSearchInfo && process.env.OUTPUT_THINK === "true") {
              if (thinkingEnabled && content.includes("<think>")) {
                content = content.replace("<think>", `<think>\n\n\n${await accountManager.generateMarkdownTable(webSearchInfo, process.env.SEARCH_INFO_MODE || "table")}\n\n\n`)
                webSearchInfo = null
              } else if (!thinkingEnabled) {
                content = `<think>\n${await accountManager.generateMarkdownTable(webSearchInfo, process.env.SEARCH_INFO_MODE || "table")}\n</think>\n${content}`
                webSearchInfo = null
              }
            }

            const StreamTemplate = {
              "id": `chatcmpl-${id}`,
              "object": "chat.completion.chunk",
              "created": new Date().getTime(),
              "choices": [
                {
                  "index": 0,
                  "delta": {
                    "content": content
                  },
                  "finish_reason": null
                }
              ]
            }
            res.write(`data: ${JSON.stringify(StreamTemplate)}\n\n`)
          } catch (error) {
            console.log(error)
            res.status(500).json({ error: "服务错误!!!" })
          }
        }
      })

      response.on('end', async () => {
        if (process.env.OUTPUT_THINK === "false" && webSearchInfo) {
          const webSearchTable = await accountManager.generateMarkdownTable(webSearchInfo, process.env.SEARCH_INFO_MODE || "table")
          res.write(`data: ${JSON.stringify({
            "id": `chatcmpl-${id}`,
            "object": "chat.completion.chunk",
            "created": new Date().getTime(),
            "choices": [
              {
                "index": 0,
                "delta": {
                  "content": `\n\n\n${webSearchTable}`
                }
              }
            ]
          })}\n\n`)
        }
        res.write(`data: [DONE]\n\n`)
        res.end()
      })
    } catch (error) {
      console.log(error)
      res.status(500).json({ error: "服务错误!!!" })
    }
  }

  const notStreamResponseT2I = async (response) => {
    try {
      const taskId = response.messages[1].extra.wanx.task_id
      //const chatId = response.chat_id
      let _count = 12  //设置轮询查询每5秒查一次图片是否已生成，尝试12次，60秒之后还未生成的直接返回超时重试
      console.log("正在生成图片,"+taskId)
      const intervalCallback = setInterval(async () => {
        try {
          if(_count==0){
              clearInterval(intervalCallback)
              res.status(500)
              .json({
                error: "超时，请重试！"
              })
           }
          const _response = await axios.get('https://chat.qwenlm.ai/api/v1/tasks/status/'+taskId,
              {
              headers: {
                  "Authorization": `Bearer ${authToken}`,
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
              }
              }
          )
          if(_response.data.task_status === 'success') {
            clearInterval(intervalCallback)
            const imgUrl = _response.data.content
            res.set({
              'Content-Type': 'application/json',
            })
            res.json({
              "created": new Date().getTime(),
              "model": req.body.model,
              "choices": [
                  {
                      "index": 0,
                      "message": {
                          "role": "assistant",
                          "content": "[image](" + imgUrl + ")"
                      },
                      "finish_reason": "stop"
                  }
              ]
          })
            console.log("结束生成图片,"+taskId)
          }
        } catch (err) {
          console.error("Request failed:", err.response?.status, err.response?.data,'https://chat.qwenlm.ai/api/v1/tasks/status/'+taskId)
          _count--
        }
        _count--
      },5000)
      
    } catch (error) {
      console.log(error)
      res.status(500)
        .json({
          error: "服务错误!!!"
        })
    }
  }

  const notStreamResponseT2V = async (response) => {
    try {
      const taskId = response.messages[1].extra.wanx.task_id
      //const chatId = response.chat_id
      let _count = 10  //设置轮询查询每5秒查一次图片是否已生成，尝试12次，60秒之后还未生成的直接返回超时重试
      console.log("正在生成视频,"+taskId)
      const intervalCallback = setInterval(async () => {
        try {
          if(_count==0){
              clearInterval(intervalCallback)
              res.status(500)
              .json({
                error: "超时，请重试！"
              })
           }
          const _response = await axios.get('https://chat.qwenlm.ai/api/v1/tasks/status/'+taskId,
              {
              headers: {
                  "Authorization": `Bearer ${authToken}`,
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
              }
              }
          )
          if(_response.data.task_status === 'success') {
            clearInterval(intervalCallback)
            const videoUrl = _response.data.content
            res.set({
              'Content-Type': 'application/json',
            })
            res.json({
              "created": new Date().getTime(),
              "model": req.body.model,
              "choices": [
                  {
                      "index": 0,
                      "message": {
                          "role": "assistant",
                          "content": "[video](" + videoUrl + ")"
                      },
                      "finish_reason": "stop"
                  }
              ]
          })
            console.log("结束生成视频,"+taskId)
          }
        } catch (err) {
          console.error("Request failed:", err.response?.status, err.response?.data,'https://chat.qwenlm.ai/api/v1/tasks/status/'+taskId)
          _count--
        }
        _count--
      },60000)
      
    } catch (error) {
      console.log(error)
      res.status(500)
        .json({
          error: "服务错误!!!"
        })
    }
  }

  try {

    console.log(req.body)

    // 判断是否开启推理
    let thinkingEnabled = false
    if (req.body.model.includes('-thinking')) {
      thinkingEnabled = true
      messages[messages.length - 1].feature_config = {
        "thinking_enabled": thinkingEnabled
      }
      req.body.model = req.body.model.replace('-thinking', '')
    }
    let searchEnabled = false
    if (req.body.model.includes('-search')) {
      searchEnabled = true
      messages[messages.length - 1].chat_type = 'search'
      req.body.model = req.body.model.replace('-search', '')
      isSearch = true
    }

    let response 

    let _id = `${uuid.v4()}`

    let t2iEnabled = false
    let t2vEnabled = false
    if (req.body.model.includes('-t2i')) {
      t2iEnabled = true
      chatType = 't2i'
      messages[messages.length - 1].chat_type = chatType
      messages[messages.length - 1].extra = {}
      messages[messages.length - 1].feature_config = {"thinking_enabled": false}
      req.body.model = req.body.model.replace('-t2i', '')

      const _userPrompt = messages[messages.length - 1].content
      let _size = "1024*1024"
      if (_userPrompt.indexOf("4:3")!=-1){
          _size = "1024*768"
      }else if (_userPrompt.indexOf("3:4")!=-1){
          _size = "768*1024"
      }else if (_userPrompt.indexOf("16:9")!=-1){
          _size = "1280*720"
      }else if (_userPrompt.indexOf("9:16")!=-1){
          _size = "720*1280"
      }

      authHeaders = process.env.AUTH_HEADERS
      
      response = await axios.post('https://chat.qwenlm.ai/api/chat/completions',
        {
          "model": req.body.model,
          "messages": messages,
          "stream": false,
          "chat_type": chatType,
          "id": _id,
          "size": _size
        },
        {
          headers: {
            "Authorization": `Bearer ${authToken}`,
            "Host": "chat.qwen.ai",
           "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0",
           "Connection": "keep-alive",
           "Accept": "*/*",
           "Accept-Encoding": "gzip, deflate, br, zstd",
           "Content-Type": "application/json",
           "x-request-id": `${uuid.v4()}`,
           "bx-umidtoken": process.env.BX_UMIDTOKEN,
           "sec-ch-ua": "\"Not(A:Brand\";v=\"99\", \"Microsoft Edge\";v=\"133\", \"Chromium\";v=\"133\"",
           "bx-ua": process.env.BX_UA,
           "sec-ch-ua-mobile": "?0",
           "sec-ch-ua-platform": "\"Windows\"",
           "bx-v": "2.5.28",
           "origin": "https://chat.qwen.ai",
           "sec-fetch-site": "same-origin",
           "sec-fetch-mode": "cors",
           "sec-fetch-dest": "empty",
           "referer": "https://chat.qwen.ai/",
           "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
           "cookie": `${process.env.COOKIE.replace("`${authToken}`",authToken)}`,
           "priority": "u=1, i"
          },
          responseType: 'json'
        }
      )
    }else if (req.body.model.includes('-t2v')) {
      t2vEnabled = true
      chatType = 't2v'
      messages[messages.length - 1].chat_type = chatType
      messages[messages.length - 1].extra = {}
      messages[messages.length - 1].feature_config = {"thinking_enabled": false}
      req.body.model = req.body.model.replace('-t2v', '')

      const _userPrompt = messages[messages.length - 1].content
      let _size = "1024*1024"
      if (_userPrompt.indexOf("4:3")!=-1){
          _size = "1024*768"
      }else if (_userPrompt.indexOf("3:4")!=-1){
          _size = "768*1024"
      }else if (_userPrompt.indexOf("16:9")!=-1){
          _size = "1280*720"
      }else if (_userPrompt.indexOf("9:16")!=-1){
          _size = "720*1280"
      }
      
      response = await axios.post('https://chat.qwenlm.ai/api/chat/completions',
        {
          "model": req.body.model,
          "messages": messages,
          "stream": false,
          "chat_type": chatType,
          "id": _id,
          "size": _size
        },
        {
          headers: {
            "Authorization": `Bearer ${authToken}`,
            "Host": "chat.qwen.ai",
           "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0",
           "Connection": "keep-alive",
           "Accept": "*/*",
           "Accept-Encoding": "gzip, deflate, br, zstd",
           "Content-Type": "application/json",
           "x-request-id": `${uuid.v4()}`,
           "bx-umidtoken": process.env.BX_UMIDTOKEN,
           "sec-ch-ua": "\"Not(A:Brand\";v=\"99\", \"Microsoft Edge\";v=\"133\", \"Chromium\";v=\"133\"",
           "bx-ua": process.env.BX_UA,
           "sec-ch-ua-mobile": "?0",
           "sec-ch-ua-platform": "\"Windows\"",
           "bx-v": "2.5.28",
           "origin": "https://chat.qwen.ai",
           "sec-fetch-site": "same-origin",
           "sec-fetch-mode": "cors",
           "sec-fetch-dest": "empty",
           "referer": "https://chat.qwen.ai/",
           "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
           "cookie": `${process.env.COOKIE.replace("`${authToken}`",authToken)}`,
           "priority": "u=1, i"
          },
          responseType: 'json'
        }
      )
    }else{
        response = await axios.post('https://chat.qwenlm.ai/api/chat/completions',
        {
            "model": req.body.model,
            "messages": messages,
            "stream": stream,
            "chat_id": _id,
            "chat_type": searchEnabled ? 'search' : "t2t"
        },
        {
           headers: {
           "Authorization": `Bearer ${authToken}`,
           "Host": "chat.qwen.ai",
           "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0",
           "Connection": "keep-alive",
           "Accept": "*/*",
           "Accept-Encoding": "gzip, deflate, br, zstd",
           "Content-Type": "application/json",
           "x-request-id": `${uuid.v4()}`,
           "bx-umidtoken": process.env.BX_UMIDTOKEN,
           "sec-ch-ua": "\"Not(A:Brand\";v=\"99\", \"Microsoft Edge\";v=\"133\", \"Chromium\";v=\"133\"",
           "bx-ua": process.env.BX_UA,
           "sec-ch-ua-mobile": "?0",
           "sec-ch-ua-platform": "\"Windows\"",
           "bx-v": "2.5.28",
           "origin": "https://chat.qwen.ai",
           "sec-fetch-site": "same-origin",
           "sec-fetch-mode": "cors",
           "sec-fetch-dest": "empty",
           "referer": "https://chat.qwen.ai/",
           "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
           "cookie": `${process.env.COOKIE.replace("`${authToken}`",authToken)}`,
           "priority": "u=1, i"
         },
            responseType: stream ? 'stream' : 'json'
        }
        )
    }
    //console.log(response)
    if(t2iEnabled){
        notStreamResponseT2I(response.data)
    }else if(t2vEnabled){
        notStreamResponseT2V(response.data)
    }else{
        if (stream) {
          res.set({
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
          })
          streamResponse(response.data, thinkingEnabled)
        } else {
          res.set({
              'Content-Type': 'application/json',
          })
          console.log(response.data)
          notStreamResponse(response.data,_id)
        }
    }

  } catch (error) {
    console.log(error)
    res.status(500)
      .json({
        error: "token无效,请求发送失败！！！"
      })
  }

})

const startInfo = `
-------------------------------------------------------------------
监听地址：${process.env.LISTEN_ADDRESS ? process.env.LISTEN_ADDRESS : 'localhost'}
服务端口：${process.env.SERVICE_PORT}
API前缀：${process.env.API_PREFIX ? process.env.API_PREFIX : '未设置'}
账户数：${accountManager ? accountManager.getAccountTokensNumber() : '未启用'}
-------------------------------------------------------------------
`
if (process.env.LISTEN_ADDRESS) {
  app.listen(process.env.SERVICE_PORT || 3000, process.env.LISTEN_ADDRESS, () => {
    console.log(startInfo)
  })
} else {
  app.listen(process.env.SERVICE_PORT || 3000, () => {
    console.log(startInfo)
  })
}
