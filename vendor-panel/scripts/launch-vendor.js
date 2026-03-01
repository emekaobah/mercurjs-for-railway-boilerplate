const { execSync } = require('child_process');
const https = require('https');
const http = require('http');

const BACKEND_URL = process.env.VITE_MEDUSA_BACKEND_URL || 'http://localhost:9000';

async function fetchPublishableKey() {
  return new Promise((resolve, reject) => {
    const url = `${BACKEND_URL}/key-exchange`;
    const client = url.startsWith('https') ? https : http;
    
    console.log('Fetching publishable API key from:', url);
    
    client.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.publishableApiKey) {
            console.log('✓ Publishable API key fetched successfully');
            resolve(json.publishableApiKey);
          } else {
            console.log('⚠ No publishable API key found in response');
            resolve('');
          }
        } catch (error) {
          console.error('Error parsing response:', error);
          resolve('');
        }
      });
    }).on('error', (error) => {
      console.error('Error fetching API key:', error.message);
      resolve('');
    });
  });
}

async function launch() {
  console.log('🚀 Launching vendor panel...\n');

  // Default vendor panel dev port.
  process.env.PORT = process.env.PORT || '7001';
  
  // Fetch the publishable API key
  const apiKey = await fetchPublishableKey();
  
  if (apiKey) {
    process.env.VITE_PUBLISHABLE_API_KEY = apiKey;
    console.log('✓ API key set in environment\n');
  }
  
  // Run vite
  console.log(`Starting Vite dev server on port ${process.env.PORT}...\n`);
  try {
    execSync('vite', { stdio: 'inherit', env: process.env });
  } catch (error) {
    console.error('Error starting Vite:', error.message);
    process.exit(1);
  }
}

launch();
