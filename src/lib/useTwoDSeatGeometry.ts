import {useLayoutEffect, type RefObject} from "react";
import {twoDSeatGeometry, type TableSeatPosition} from "./twoDSeatGeometry";
export function useTwoDSeatGeometry(ref:RefObject<HTMLDivElement|null>, enabled:boolean, handId:string) {
  useLayoutEffect(()=>{
    const stage=ref.current;
    const table=stage?.querySelector<HTMLElement>(".poker-table");
    if(!enabled||!stage||!table) return;
    const measure=()=>{
      const bounds=table.getBoundingClientRect(), stageBounds=stage.getBoundingClientRect();
      const zoom=stageBounds.width/stage.offsetWidth;
      const h=stage.querySelector<HTMLElement>(".opponent-cards .playing-card, .hero-hole-cards-visual .playing-card")?.offsetHeight ?? 58;
      const board=stage.querySelector<HTMLElement>(".community-cards")?.getBoundingClientRect();
      if(board) {
        const screen=stage.closest<HTMLElement>(".table-screen");
        if(screen) screen.style.setProperty("--review-verdict-top", `${(board.bottom-screen.getBoundingClientRect().top)/zoom+8}px`);
        stage.style.setProperty("--review-hand-x",`${(board.left-stageBounds.left)/zoom-h*1.25}px`);
        stage.style.setProperty("--review-hand-y",`${(board.top+board.height/2-stageBounds.top)/zoom}px`);
      }
      for(const seat of stage.querySelectorAll<HTMLElement>(".player-seat")) {
        const position = (["top","upper-left","upper-right","lower-left","lower-right","hero"] as const).find(p=>seat.classList.contains(`player-seat--${p}`))!;
        const box=seat.getBoundingClientRect();
        const name=seat.querySelector(".seat-label")?.getBoundingClientRect();
        const geometry=twoDSeatGeometry(position as TableSeatPosition,bounds.width/zoom,bounds.height/zoom,h,position==="top"&&name?(name.bottom-bounds.top)/zoom:0);
        // In review, group the bottom hand and its chips beside the board so
        // the larger decision verdict never conceals the cards being reviewed.
        if(position==="hero" && stage.closest('[data-review="true"]') && board && stage.offsetWidth>760) {
          geometry.card={x:(board.left-bounds.left)/zoom-h*1.25,y:(board.top+board.height/2-bounds.top)/zoom};
          geometry.stack={x:geometry.card.x-h*5/7-51,y:geometry.card.y};
          geometry.bet={x:geometry.card.x,y:geometry.card.y-h-14};
        }
        for(const [kind,point] of Object.entries({cards:geometry.card,stack:geometry.stack,bet:geometry.bet,runout:geometry.runout})) {
          seat.style.setProperty(`--local-${kind}-x`,`${(bounds.left-box.left)/zoom+point.x}px`);
          seat.style.setProperty(`--local-${kind}-y`,`${(bounds.top-box.top)/zoom+point.y}px`);
          if(position==="hero") {
            stage.style.setProperty(`--bottom-${kind}-x`,`${(bounds.left-stageBounds.left)/zoom+point.x}px`);
            stage.style.setProperty(`--bottom-${kind}-y`,`${(bounds.top-stageBounds.top)/zoom+point.y}px`);
          }
        }
        seat.style.setProperty("--local-card-angle",`${geometry.angle}deg`);
      }
    };
    measure(); const observer=new ResizeObserver(measure); observer.observe(stage); observer.observe(table);
    return ()=>observer.disconnect();
  },[ref,enabled,handId]);
}
