import type {ElectronApplication,Page} from '@playwright/test';

// CDP's virtual mouse does not reliably update Win32 GetCursorPos, especially
// on a locked desktop. Keep the desktop pointer aligned for hover UI tests.
// The stale-enter regression deliberately keeps its desktop pointer outside.
export async function hoverWidget(app:ElectronApplication,page:Page){
 const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.getBounds()),box=await page.locator('#compact').boundingBox();
 if(!box)throw Error('Status screen is not visible');
 await app.evaluate(({screen},p)=>{screen.getCursorScreenPoint=()=>p;},{x:bounds.x+box.x+box.width/2,y:bounds.y+box.y+box.height/2});
 await page.locator('#compact').hover();
}
export async function mouseOutside(app:ElectronApplication,page:Page){
 await app.evaluate(({screen})=>{screen.getCursorScreenPoint=()=>({x:-10000,y:-10000});});
 await page.mouse.move(-20,-20);
}
