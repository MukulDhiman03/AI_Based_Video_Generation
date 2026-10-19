import {z} from 'zod';

export const voices = [
  {key:'viraj',name:'Viraj',description:'Energetic & confident',initial:'V'},
  {key:'monika',name:'Monika Sogam',description:'Deep & natural',initial:'M'},
] as const;

export const requestSchema = z.discriminatedUnion('format',[
  z.object({format:z.literal('reel'),topic:z.string().trim().min(10).max(1500),language:z.enum(['English','Hindi']),duration:z.union([z.literal(30),z.literal(60),z.literal(90)]),voice:z.enum(['viraj','monika'])}).strict(),
  z.object({format:z.literal('image'),topic:z.string().trim().min(10).max(1500),language:z.enum(['English','Hindi'])}).strict(),
]);
export type ContentRequest=z.infer<typeof requestSchema>;
export const planSchema=z.object({
  title:z.string().min(1).max(160),
  summary:z.string().min(1).max(800),
  caption:z.string().min(1).max(2200),
  scenes:z.array(z.object({
    title:z.string().min(1).max(160),
    narration:z.string().max(2200),
    visual:z.string().min(1).max(1200),
    template:z.enum(['title','diagram','comparison','process','summary']),
  }).strict()).min(1).max(12),
}).strict();
export type ContentPlan=z.infer<typeof planSchema>;
export type Draft={id:string;createdAt:string;request:ContentRequest;plan:ContentPlan};
export const DRAFT_KEY='vidsutra.local.drafts.v1';
export function readDrafts():Draft[]{
  try {const raw=JSON.parse(localStorage.getItem(DRAFT_KEY)||'[]');return z.array(z.object({id:z.string(),createdAt:z.string(),request:requestSchema,plan:planSchema})).parse(raw);} catch {return [];}
}
export const ideas=[
  {category:'TECHNOLOGY',title:'What happens when you open a website?',description:'Follow a single click through requests, packets, and servers.',color:'violet',number:'01'},
  {category:'SCIENCE',title:'Why does the sky turn orange at sunset?',description:'Make light scattering feel simple with a visual explanation.',color:'peach',number:'02'},
  {category:'EVERYDAY SCIENCE',title:'How does noise cancellation work?',description:'Explain how sound waves can help cancel other sound waves.',color:'green',number:'03'},
  {category:'TECHNOLOGY',title:'What is machine learning, really?',description:'Turn patterns, training, and predictions into an easy story.',color:'blue',number:'04'},
];
