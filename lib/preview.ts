/**
 * The private preview of the view from above (docs/PHOTO_3D_PREVIEW.md): the same app at /preview/,
 * which the server serves only behind a password (deploy/Caddyfile), with the server's offer of a 3D
 * tileset read from /preview/photo3d.json — behind the same password, and never written into the
 * public config.json unless the owner has made the view public. The public page never asks for it.
 */
import {z} from 'zod';
import {photo3dSchema} from '@/lib/live';
import type {Photo3d} from '@/lib/gods-eye';

export const PREVIEW_OFFER_URL='/preview/photo3d.json';

/** Whether this page is the private preview: by its address, which the server guards. */
export function isPreviewPath(pathname:string):boolean{
 return pathname==='/preview'||pathname.startsWith('/preview/');
}

const offerSchema=z.object({schemaVersion:z.literal(1),photo3d:photo3dSchema,public:z.boolean().optional()});

/** The preview's offer, or null (none configured, the password refused, or unreadable). */
export async function loadPreviewOffer():Promise<Photo3d|null>{
 try{
  const response=await fetch(PREVIEW_OFFER_URL,{cache:'no-store',credentials:'same-origin'});
  if(!response.ok)return null;
  return offerSchema.parse(await response.json()).photo3d;
 }catch{return null}
}
