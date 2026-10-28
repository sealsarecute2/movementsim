// A small original block alphabet keeps world signs sharp and texture-free.
const SIGN_GLYPHS = {
  A:[14,17,17,31,17,17,17],B:[30,17,17,30,17,17,30],C:[14,17,16,16,16,17,14],
  D:[30,17,17,17,17,17,30],E:[31,16,16,30,16,16,31],F:[31,16,16,30,16,16,16],
  G:[14,17,16,23,17,17,15],H:[17,17,17,31,17,17,17],I:[14,4,4,4,4,4,14],
  J:[7,2,2,2,18,18,12],K:[17,18,20,24,20,18,17],L:[16,16,16,16,16,16,31],
  M:[17,27,21,21,17,17,17],N:[17,25,21,19,17,17,17],O:[14,17,17,17,17,17,14],
  P:[30,17,17,30,16,16,16],Q:[14,17,17,17,21,18,13],R:[30,17,17,30,20,18,17],
  S:[15,16,16,14,1,1,30],T:[31,4,4,4,4,4,4],U:[17,17,17,17,17,17,14],
  V:[17,17,17,17,17,10,4],W:[17,17,17,21,21,21,10],X:[17,17,10,4,10,17,17],
  Y:[17,17,10,4,4,4,4],Z:[31,1,2,4,8,16,31],
  '0':[14,17,19,21,25,17,14],'1':[4,12,4,4,4,4,14],'2':[14,17,1,2,4,8,31],
  '3':[30,1,1,14,1,1,30],'4':[2,6,10,18,31,2,2],'5':[31,16,16,30,1,1,30],
  '6':[14,16,16,30,17,17,14],'7':[31,1,2,4,8,8,8],'8':[14,17,17,14,17,17,14],
  '9':[14,17,17,15,1,1,14],' ':[0,0,0,0,0,0,0],'/':[1,2,2,4,8,8,16],
  '+':[0,4,4,31,4,4,0],'-':[0,0,0,31,0,0,0],'=':[0,31,0,31,0,0,0],
  '.':[0,0,0,0,0,12,12],',':[0,0,0,0,4,4,8],':':[0,12,12,0,12,12,0],
  '?':[14,17,1,2,4,0,4],
};

export function buildSignMesh(board) {
  const rows=[board.sign.title,...board.sign.lines].map(line=>line.toUpperCase());
  const width=board.max[0]-board.min[0],height=board.max[1]-board.min[1];
  const size=Math.min(1.6,(width-24)/Math.max(1,...rows.map(line=>line.length*6-1)),(height-24)/(rows.length*11-4));
  const vertices=[],z=board.max[2]+.08,left=board.min[0]+12,top=board.max[1]-12;
  const quad=(x,y,w,h,colour)=>{
    const corners=[[x,y,z],[x,y-h,z],[x+w,y-h,z],[x+w,y,z]];
    for(const i of [0,1,2,0,2,3])vertices.push(...corners[i],...colour,0,0,0,1,-1);
  };
  rows.forEach((line,row)=>{
    const colour=row?[.88,.92,.96]:[.34,.78,1];
    for(let letter=0;letter<line.length;letter++){
      const glyph=SIGN_GLYPHS[line[letter]]||SIGN_GLYPHS['?'];
      glyph.forEach((bits,y)=>{
        for(let x=0;x<5;x++)if(bits&(1<<(4-x))){
          const start=x;while(x+1<5&&(bits&(1<<(3-x))))x++;
          quad(left+(letter*6+start)*size,top-(row*11+y)*size,(x-start+1)*size,size,colour);
        }
      });
    }
  });
  return vertices;
}
