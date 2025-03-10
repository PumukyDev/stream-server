require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get the Telegram Bot token from the .env file
const token = process.env.TELEGRAM_BOT_TOKEN;

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

// Matches "/echo [whatever]"
bot.onText(/\/echo (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const resp = match[1];
  bot.sendMessage(chatId, resp);
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `
Available commands:

/da [URL] - Download YouTube audio and add it to the radio
/dv [URL] [optional name] - Download and stream a YouTube video

Examples:
  /da https://www.youtube.com/watch?v=dQw4w9WgXcQ
  /dv https://www.youtube.com/watch?v=dQw4w9WgXcQ
  /dv https://www.youtube.com/watch?v=dQw4w9WgXcQ Never Gonna Give You Up
  `;

  bot.sendMessage(chatId, helpMessage);
});

// Handle unknown commands
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text.startsWith("/") && !["/da", "/dv", "/help"].some(cmd => text.startsWith(cmd))) {
    bot.sendMessage(chatId, "Unknown command. Type /help for a list of available commands.");
  }
});

// Download Video command configuration
bot.onText(/\/dv (\S+)(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1];
  const customName = match[2] ? match[2].replace(/\s+/g, '_') : `video_${Date.now()}`;

  // Limit name length to 25 characters
  if (customName.length > 25) {
    bot.sendMessage(chatId, 'The name cannot be longer than 25 characters, please set a shorter name.');
    return;
  }

  if (isValidUrl(url)) {
    bot.sendMessage(chatId, 'Processing video...');
    try {
      const hlsUrl = await downloadVideo(url, customName);
      bot.sendMessage(chatId, `Download and conversion complete! Watch the video at:\n ${hlsUrl} on VLC, or see all available videos at https://stream.pumukydev.com/video/`);
    } catch (error) {
      bot.sendMessage(chatId, `Error processing video: ${error.message || error}`);
    }
  } else {
    bot.sendMessage(chatId, 'The URL is not valid.');
  }
});

// Download Audio command configuration
bot.onText(/\/da (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1];

  if (isValidUrl(url)) {
    bot.sendMessage(chatId, 'Processing your audio...');
    try {
      const audioPath = await downloadAudio(url);
      bot.sendMessage(chatId, 'Download complete! Listen to the playlist at https://stream.pumukydev.com/audio/');
    } catch (error) {
      bot.sendMessage(chatId, "I can't download it, are you sure it's a valid YouTube URL?");
    }
  } else {
    bot.sendMessage(chatId, 'This is not a URL');
  }
});

// Helper function to download audio using yt-dlp
async function downloadAudio(url) {
  return new Promise((resolve, reject) => {
    const fileDate = `${Date.now()}`;
    const audioOutputPath = `downloads/audio/${fileDate}.mp3`;
    const oggOutputPath = `downloads/audio/${fileDate}.ogg`;

    // Download the audio in mp3
    const downloadCommand = `yt-dlp -x --audio-format mp3 -o "${audioOutputPath}" ${url}`;

    exec(downloadCommand, (error, stdout, stderr) => {
      if (error) {
        reject(`Error running yt-dlp: ${stderr || error.message}`);
        return;
      }

      console.log(stdout);

      // Convert mp3 file to ogg
      const conversionCommand = `ffmpeg -i "${audioOutputPath}" -acodec libvorbis "${oggOutputPath}"`;

      exec(conversionCommand, (convertError, convertStdout, convertStderr) => {
        if (convertError) {
          reject(`Error converting to ogg: ${convertStderr || convertError.message}`);
          return;
        }

        console.log('Conversion successful:', convertStdout);

        // Delete the original mp3 file
        fs.unlink(audioOutputPath, (err) => {
          if (err) {
            console.error('Error deleting MP3 file:', err);
          } else {
            console.log('MP3 file deleted:', audioOutputPath);
          }
        });

        // Update list.txt
        fs.appendFile('downloads/audio/list.txt', `/audio/${fileDate}.ogg\n`, (err) => {
          if (err) {
            console.error('Error updating list.txt:', err);
          } else {
            console.log('list.txt updated with new audio:', oggOutputPath);
          }
        });

        resolve(oggOutputPath);
      });
    });
  });
}

// Helper function to download video using yt-dlp and convert to HLS
async function downloadVideo(url, folderName) {
  return new Promise((resolve, reject) => {
    const videoOutputPath = `downloads/video/${folderName}.mp4`;
    const hlsOutputDir = `downloads/video/${folderName}`;
    const hlsFile = `output.m3u8`;
    const hlsUrl = `https://stream.pumukydev.com/media/video/${folderName}/${hlsFile}`;

    // Command to download the video
    const downloadCommand = `yt-dlp -f "136+140" -o "${videoOutputPath}" ${url}`;

    exec(downloadCommand, (error, stdout, stderr) => {
      if (error) {
        reject(`Error running yt-dlp: ${stderr || error.message}`);
        return;
      }
      console.log('Video downloaded:', stdout);

      // Create HLS directory
      exec(`mkdir -p ${hlsOutputDir}`, (mkdirError) => {
        if (mkdirError) {
          reject(`Error creating HLS directory: ${mkdirError.message}`);
          return;
        }

        // Convert the video to HLS
        const hlsCommand = `ffmpeg -i "${videoOutputPath}" -codec: copy -start_number 0 -hls_time 10 -hls_list_size 0 -hls_segment_filename "${hlsOutputDir}/segment_%03d.ts" -f hls "${hlsOutputDir}/${hlsFile}"`;

        exec(hlsCommand, (ffmpegError, ffmpegStdout, ffmpegStderr) => {
          if (ffmpegError) {
            reject(`Error running ffmpeg: ${ffmpegStderr || ffmpegError.message}`);
            return;
          }
          console.log('Video converted to HLS:', ffmpegStdout);

          // Delete the original MP4 file
          fs.unlink(videoOutputPath, (err) => {
            if (err) {
              console.error('Error deleting MP4 file:', err);
            } else {
              console.log('MP4 file deleted:', videoOutputPath);
            }
          });

          resolve(hlsUrl);
        });
      });
    });
  });
}

// Helper function to validate URLs
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (err) {
    return false;
  }
}
