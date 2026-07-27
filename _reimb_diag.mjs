import fs from 'fs';
const path = 'C:/Users/1298/Desktop/31260725_按发票排列.pdf';
const buf = fs.readFileSync(path);
const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
const data = await pdfParse(buf, { max: 0 });
const text = data.text || '';
// 打印全部文字层，分段显示
console.log('===== RAW TEXT (full) =====');
console.log(text);
console.log('===== /RAW =====');
