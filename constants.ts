import { VideoData } from './types';

export const DEMO_VIDEO: VideoData = {
  id: 'demo-1',
  title: 'Steve Jobs 2005 Stanford Commencement Address',
  videoId: 'UF8uR6Z6KLc', // Official Stanford channel, very reliable for embedding
  transcript: [
    { id: '1', text: "I am honored to be with you today at your commencement from one of the finest universities in the world.", start: 16, duration: 8 },
    { id: '2', text: "I never graduated from college.", start: 25, duration: 2 },
    { id: '3', text: "Truth be told, this is the closest I've ever gotten to a college graduation.", start: 28, duration: 5 },
    { id: '4', text: "Today I want to tell you three stories from my life.", start: 35, duration: 4 },
    { id: '5', text: "That's it. No big deal. Just three stories.", start: 40, duration: 4 },
    { id: '6', text: "The first story is about connecting the dots.", start: 45, duration: 3 },
    { id: '7', text: "I dropped out of Reed College after the first 6 months, but then stayed around as a drop-in for another 18 months or so before I really quit.", start: 49, duration: 10 },
    { id: '8', text: "So why did I drop out?", start: 60, duration: 2 },
  ]
};