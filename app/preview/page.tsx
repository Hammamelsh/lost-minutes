import type {Metadata} from 'next';
import Home from '../page';

/**
 * The private preview: the same app, at an address the server serves only behind a password
 * (deploy/Caddyfile), where the view from above can be tried before it is public
 * (docs/PHOTO_3D_PREVIEW.md). The page itself works out that it is the preview (lib/preview.ts).
 */
export const metadata:Metadata={title:'Lost Minutes — private preview',robots:{index:false,follow:false}};

export default function Preview(){
 return <Home/>;
}
