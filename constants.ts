import { VideoData } from './types';

export const DEMO_VIDEO: VideoData = {
  id: 'demo-1',
  title: 'Steve Jobs 2005 Stanford Commencement Address',
  videoId: 'UF8uR6Z6KLc', // Official Stanford channel, very reliable for embedding
  sourceType: 'youtube',
  transcript: [
    {
      id: '1',
      text: "I am honored to be with you today at your commencement from one of the finest universities in the world.",
      translation: "今天能在这所世界上最优秀的大学之一的毕业典礼上与你们同在，我深感荣幸。",
      start: 16,
      duration: 8
    },
    {
      id: '2',
      text: "I never graduated from college.",
      translation: "我从大学退学了，从未毕业。",
      start: 25,
      duration: 2
    },
    {
      id: '3',
      text: "Truth be told, this is the closest I've ever gotten to a college graduation.",
      translation: "说实话，这是我一生中最接近大学毕业的一次。",
      start: 28,
      duration: 5
    },
    {
      id: '4',
      text: "Today I want to tell you three stories from my life.",
      translation: "今天我想和你们分享我人生中的三个故事。",
      start: 35,
      duration: 4
    },
    {
      id: '5',
      text: "That's it. No big deal. Just three stories.",
      translation: "仅此而已，不是什么大道理，就三个故事。",
      start: 40,
      duration: 4
    },
    {
      id: '6',
      text: "The first story is about connecting the dots.",
      translation: "第一个故事是关于把点连成线。",
      start: 45,
      duration: 3
    },
    {
      id: '7',
      text: "I dropped out of Reed College after the first 6 months, but then stayed around as a drop-in for another 18 months or so before I really quit.",
      translation: "我在里德学院读了六个月就退学了，但之后又以旁听生身份待了大约十八个月，才真正离开。",
      start: 49,
      duration: 10
    },
    {
      id: '8',
      text: "So why did I drop out?",
      translation: "那么，我为什么要退学呢？",
      start: 60,
      duration: 2
    },
  ]
};
