const axios = require('axios')

class Account {
  constructor(accountTokens) {
    this.accountTokens = this.init(accountTokens)
    this.errorAccountTokens = []
    this.currentIndex = 0
    this.requestNumber = 0
    this.checkAllAccountTokens()
    this.models = [
      "qwen-max-latest",
      "qwen-plus-latest",
      "qwen2.5-vl-72b-instruct",
      "qwen2.5-14b-instruct-1m",
      "qvq-72b-preview",
      "qwq-32b-preview",
      "qwen2.5-coder-32b-instruct",
      "qwen-turbo-latest",
      "qwen2.5-72b-instruct"
    ]
  }

  init(accountTokens) {
    return accountTokens.split(',')
  }

  getAccountToken() {
    if (this.currentIndex >= this.accountTokens.length) {
      this.currentIndex = 0
    }
    const token = this.accountTokens[this.currentIndex]
    this.currentIndex++
    this.requestNumber++
    return token
  }

  async checkAccountToken(token) {
    try {
      await axios.get('https://chat.qwenlm.ai/api/models',
        {
          headers: {
            "Authorization": `Bearer ${token}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        })
      return true
    } catch (error) {
      return false
    }
  }

  async checkAllAccountTokens() {
    for (const token of this.accountTokens) {
      const isTokenValid = await this.checkAccountToken(token)
      if (!isTokenValid) {
        this.errorAccountTokens.push(token.slice(0, Math.floor(token.length / 2)) + '...')
        this.accountTokens.splice(this.accountTokens.indexOf(token), 1)
      }
    }
  }

  getAccountTokensNumber() {
    return this.accountTokens.length
  }

  getRequestNumber() {
    return this.requestNumber
  }

  getErrorAccountTokens() {
    return this.errorAccountTokens
  }

  getErrorAccountTokensNumber() {
    return this.errorAccountTokens.length
  }

  async getModelList() {
    const modelsList = []
    for (const item of this.models) {
      modelsList.push(item)
      modelsList.push(item + '-thinking')
      modelsList.push(item + '-search')
      modelsList.push(item + '-thinking-search')
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
    return models
  }
  async generateMarkdownTable(websites, mode) {
    // 输入校验
    if (!Array.isArray(websites) || websites.length === 0) {
      return ""
    }
    
    let markdown = ""
    if (mode === "table"){        
        markdown += "| **序号** | **网站URL** | **来源** |\n"
        markdown += "|:---|:---|:---|\n"
    }
    // 默认值
    const DEFAULT_TITLE = "未知标题"
    const DEFAULT_URL = "https://www.baidu.com"
    const DEFAULT_HOSTNAME = "未知来源"

    // 表格内容
    websites.forEach((site, index) => {
      const { title, url, hostname } = site
      // 处理字段值，若为空则使用默认值
      const urlCell = `[${this.escapeMarkdown(title || DEFAULT_TITLE)}](${url || DEFAULT_URL})`
      const hostnameCell = this.escapeMarkdown(hostname || DEFAULT_HOSTNAME)
      if (mode === "table"){
        markdown += `| ${index + 1} | ${urlCell} | ${hostnameCell} |\n`
      } else {
        markdown += `[${index + 1}] ${urlCell} | 来源: ${hostnameCell}\n`
      }
    })

    return markdown
  }

  escapeMarkdown(text) {
    return text
      .replace(/\|/g, "\\|")
      .replace(/\*/g, "\\*")
      .replace(/#/g, "\\#")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
  }
}

module.exports = Account
