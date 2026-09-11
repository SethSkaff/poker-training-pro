export type TableSeatPosition = "top" | "upper-left" | "upper-right" | "lower-left" | "lower-right" | "hero";
export interface Point { x: number; y: number }
const angles: Record<TableSeatPosition, number> = { top:-90, "upper-left":-150, "upper-right":-30, "lower-left":150, "lower-right":30, hero:90 };
/** A seat faces the center. Its personal-left is perpendicular to that direction;
 * the card baseline follows the ellipse tangent, independent of screen-left. */
export function twoDSeatGeometry(position: TableSeatPosition, width: number, height: number, cardHeight: number, topClearance = 0) {
  const theta = angles[position] * Math.PI / 180;
  const center = {x:width/2,y:height/2};
  const rail = {x:center.x + width*.5*Math.cos(theta),y:center.y+height*.5*Math.sin(theta)};
  const length = Math.hypot(center.x-rail.x,center.y-rail.y);
  const inward = {x:(center.x-rail.x)/length,y:(center.y-rail.y)/length};
  const left = {x:inward.y,y:-inward.x};
  const card = {x:center.x+(rail.x-center.x)*.78,y:center.y+(rail.y-center.y)*.78};
  if(position === "top") card.y = Math.max(card.y,topClearance+cardHeight/2+16);
  if(position === "hero") card.y = height-cardHeight/2-18;
  const angle = Math.atan2(-height*Math.cos(theta),width*Math.sin(theta))*180/Math.PI;
  const pairHalf = cardHeight*5/7+3;
  const fit = (point:Point, halfX:number, halfY:number) => {
    const p={...point};
    for(let i=0;i<160;i++) {
      if([-1,1].every(x=>[-1,1].every(y=>((p.x+x*halfX-center.x)/(width/2-12))**2+((p.y+y*halfY-center.y)/(height/2-12))**2<=1))) break;
      p.x += (center.x-p.x)*.025; p.y += (center.y-p.y)*.025;
    }
    return p;
  };
  // Keep the stack just outside the complete two-card footprint.  The previous
  // clearance was enough for the old compact card lane, but the authored 2D
  // cards are taller and their shadows made the lower side seats read as if
  // the amount plaque were touching a card corner.
  const stack = fit({x:card.x+left.x*(pairHalf+80),y:card.y+left.y*(pairHalf+80)},42,20);
  // Bets sit on the inward radial lane.  Give side-seat cards a little more
  // separation so a long amount cannot intrude into the nearest card face;
  // the hero keeps its tighter lane because its cards already have a dedicated
  // bottom station and the extra distance would detach the wager from it.
  const betClearance = position === "hero" ? cardHeight + 14 : cardHeight + 42;
  const bet = {x:card.x+inward.x*betClearance,y:card.y+inward.y*betClearance};
  const revealInset = position === "top" ? .12 : position === "hero" ? .16 : .28;
  const runout = {x:card.x+(center.x-card.x)*revealInset,y:card.y+(center.y-card.y)*revealInset};
  return {card,stack,bet,runout,inward,left,angle};
}
