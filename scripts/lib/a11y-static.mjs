/**
 * Dependency-free static accessibility checks on server-rendered HTML.
 * A smoke gate for regressions, not a substitute for manual WCAG review.
 */
const strip=html=>html.replace(/<script\b[\s\S]*?<\/script>/gi,"").replace(/<style\b[\s\S]*?<\/style>/gi,"").replace(/<!--[\s\S]*?-->/g,"");
const attr=(tag,name)=>{const m=tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`,"i"));return m?(m[1]??m[2]):null;};
const text=html=>html.replace(/<[^>]+>/g," ").replace(/&[a-z#0-9]+;/gi," ").replace(/\s+/g," ").trim();

export function checkHtmlAccessibility(rawHtml,{allowMissingH1=false}={}){
 const html=strip(rawHtml);
 const problems=[];
 const htmlTag=html.match(/<html\b[^>]*>/i)?.[0]??"";
 if(!/^[a-z]{2}(-[A-Z]{2})?$/.test(attr(htmlTag,"lang")??""))problems.push("html element needs a valid lang attribute");
 if(!/<title>[^<]+<\/title>/i.test(html))problems.push("page needs a non-empty <title>");
 const h1=(html.match(/<h1\b/gi)??[]).length;
 if(!allowMissingH1&&h1!==1)problems.push(`page must have exactly one <h1> (found ${h1})`);
 const mains=(html.match(/<main\b/gi)??[]).length;
 if(mains!==1)problems.push(`page must have exactly one <main> landmark (found ${mains})`);
 const mainId=attr(html.match(/<main\b[^>]*>/i)?.[0]??"","id");
 if(!mainId||!new RegExp(`<a\\b[^>]*href="#${mainId}"`,"i").test(html))problems.push("skip link to the main landmark is missing");
 const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
 const dup=ids.filter((id,i)=>ids.indexOf(id)!==i);
 if(dup.length)problems.push(`duplicate id(s): ${[...new Set(dup)].join(", ")}`);
 for(const img of html.match(/<img\b[^>]*>/gi)??[])if(attr(img,"alt")===null)problems.push("img without alt attribute");
 if(/\stabindex="[1-9]/i.test(html))problems.push("positive tabindex disrupts focus order");
 for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
  const tag=`<a${m[1]}>`;
  if(!text(m[2])&&!attr(tag,"aria-label")&&!/<img\b[^>]*alt="[^"]+"/i.test(m[2]))problems.push(`link without accessible name: ${attr(tag,"href")}`);
 }
 const labelled=new Set([...html.matchAll(/<label\b[^>]*\sfor="([^"]+)"/gi)].map(m=>m[1]));
 for(const field of html.match(/<(input|select|textarea)\b[^>]*>/gi)??[]){
  const type=(attr(field,"type")??"").toLowerCase();
  if(["hidden","submit","button","reset"].includes(type))continue;
  const id=attr(field,"id");
  if(!(id&&labelled.has(id))&&!attr(field,"aria-label")&&!attr(field,"aria-labelledby"))problems.push(`form field without label: ${id??field.slice(0,40)}`);
 }
 for(const b of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi))
  if(!text(b[2])&&!attr(`<b${b[1]}>`,"aria-label"))problems.push("button without accessible name");
 return problems;
}
