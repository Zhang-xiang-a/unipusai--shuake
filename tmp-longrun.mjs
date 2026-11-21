let n = 0;
const timer = setInterval(() => { console.log('tick ' + (++n)); }, 400);
process.on('SIGINT', () => { console.log('GOT SIGINT'); clearInterval(timer); process.exit(130); });
process.on('SIGBREAK', () => { console.log('GOT SIGBREAK'); clearInterval(timer); process.exit(131); });
