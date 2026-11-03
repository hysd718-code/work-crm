// 重新生成 css/tailwind.css 用的配置（平时不需要）。在本目录的上一级运行：
//   npx tailwindcss@3.4.17 -c tools/tailwind.config.js -i tools/input.css -o css/tailwind.css --minify
const path = require('path');
module.exports = {
  content: [path.join(__dirname, '..', 'index.html'), path.join(__dirname, '..', 'js', '*.js')],
  // calendar.js 里用 `min-w-[${n}px]` 拼出来的类名扫描不到，手动列出
  safelist: ['min-w-[640px]', 'min-w-[0px]'],
  theme: { extend: {} },
  plugins: [],
};
