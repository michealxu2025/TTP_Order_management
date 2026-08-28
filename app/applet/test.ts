import https from 'https';
https.get('https://docs.google.com/spreadsheets/d/1sL-g0IiPox4FymR4Qt8Ru1ErqXZXuZLRxfM-_1wOE9A/export?format=csv&gid=432782581', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(data.split('\n')[0]);
  });
});
