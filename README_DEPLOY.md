# 陈京个人作品集网站｜Vercel 部署包

这是一个纯静态网页部署包，可直接部署到 Vercel。

## 文件结构

```text
index.html
assets/
vercel.json
README_DEPLOY.md
```

## 方式一：Vercel 网页端上传

1. 登录 Vercel。
2. 新建 Project。
3. 上传本文件夹，或上传 `chenjing-vercel-deploy.zip` 解压后的内容。
4. Framework Preset 选择 Other / Static。
5. Build Command 留空。
6. Output Directory 留空或填写 `.`。
7. 点击 Deploy。

## 方式二：GitHub + Vercel

1. 新建 GitHub 仓库。
2. 将本文件夹内的 `index.html`、`assets/`、`vercel.json` 提交到仓库根目录。
3. 在 Vercel 中 Import Git Repository。
4. Framework Preset 选择 Other / Static。
5. Build Command 留空。
6. Output Directory 留空或填写 `.`。
7. 点击 Deploy。

## 域名绑定建议

在 Vercel 项目中进入 Settings → Domains，添加：

- `chenjing-portfolio.art`
- `www.chenjing-portfolio.art`

然后去阿里云 DNS 解析中添加 Vercel 要求的记录。通常为：

- 根域名 `@`：A 记录 → `76.76.21.21`
- `www`：CNAME 记录 → `cname.vercel-dns.com` 或 Vercel 后台提示的目标值

请以 Vercel Domains 页面给出的记录为准。

## 后续修改方式

推荐使用 GitHub + Vercel。以后只要更新代码并 push，Vercel 会自动重新部署；也可以手动重新上传本部署包。
