/* Bounded MCP envelope cursor. Business payloads are forwarded unchanged and
 * validated by the existing ingestion schemas. */
typedef struct {const char *a,*b;} JsonSpan;
static int json_budget;
static const char *white(const char *p,const char *e){while(p<e&&(*p==' '||*p=='\t'||*p=='\r'||*p=='\n'))p++;return p;}
static int hex(char c){return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;}
static const char *json_string(const char *p,const char *e){if(p>=e||*p++!='"')return 0;while(p<e){unsigned char c=(unsigned char)*p++;if(c=='"')return p;if(c<32)return 0;if(c=='\\'){if(p>=e)return 0;c=(unsigned char)*p++;if(c=='u'){for(int n=0;n<4;n++)if(p>=e||hex(*p++)<0)return 0;}else if(c!='"'&&c!='\\'&&c!='/'&&c!='b'&&c!='f'&&c!='n'&&c!='r'&&c!='t')return 0;}}return 0;}
static const char *json_skip(const char *p,const char *e,int depth){
 if(!p||--json_budget<0||depth>32)return 0;p=white(p,e);if(p>=e)return 0;if(*p=='"')return json_string(p,e);
 if(*p=='{'||*p=='['){char close=*p++=='{'?'}':']';p=white(p,e);if(p<e&&*p==close)return p+1;while(p<e){if(close=='}'){p=json_string(p,e);if(!p)return 0;p=white(p,e);if(p>=e||*p++!=':')return 0;}p=json_skip(p,e,depth+1);if(!p)return 0;p=white(p,e);if(p>=e)return 0;if(*p==close)return p+1;if(*p++!=',')return 0;p=white(p,e);}return 0;}
 for(int n=0;n<3;n++){const char *word=n==0?"true":n==1?"false":"null",*q=p;while(*word&&q<e&&*q==*word){q++;word++;}if(!*word)return q;}
 const char *q=p;if(*q=='-')q++;if(q>=e)return 0;if(*q=='0')q++;else{if(*q<'1'||*q>'9')return 0;while(q<e&&*q>='0'&&*q<='9')q++;}if(q<e&&*q=='.'){q++;const char *start=q;while(q<e&&*q>='0'&&*q<='9')q++;if(start==q)return 0;}if(q<e&&(*q=='e'||*q=='E')){q++;if(q<e&&(*q=='+'||*q=='-'))q++;const char *start=q;while(q<e&&*q>='0'&&*q<='9')q++;if(start==q)return 0;}return q;
}
static int json_valid(JsonSpan s){json_budget=32768;const char *end=json_skip(s.a,s.b,0);return end&&white(end,s.b)==s.b;}
static int ascii_string(JsonSpan s,char *out,unsigned capacity){const char *p=s.a;unsigned n=0;if(!p||p>=s.b||*p++!='"')return 0;while(p<s.b){unsigned c=(unsigned char)*p++;if(c=='"'){out[n]=0;return p==s.b;}if(c=='\\'){if(p>=s.b)return 0;c=(unsigned char)*p++;if(c=='u'){c=0;for(int j=0;j<4;j++){if(p>=s.b||hex(*p)<0)return 0;c=c*16+(unsigned)hex(*p++);}}else if(c=='b')c=8;else if(c=='f')c=12;else if(c=='n')c=10;else if(c=='r')c=13;else if(c=='t')c=9;}if(c<32||c>126||n+1>=capacity)return 0;out[n++]=(char)c;}return 0;}
static int text_equal(const char *a,const char *b){while(*a&&*a==*b){a++;b++;}return *a==*b;}
/* Reject duplicate routing fields to avoid first/last-key ambiguity. */
static JsonSpan member(JsonSpan object,const char *key){JsonSpan result={0,0};const char *p=object.a;if(!p||p>=object.b||*p++!='{')return result;json_budget=32768;while((p=white(p,object.b))<object.b&&*p!='}'){const char *start=p,*end=json_string(p,object.b);if(!end)return (JsonSpan){0,0};char name[64];int match=ascii_string((JsonSpan){start,end},name,sizeof(name))&&text_equal(name,key);p=white(end,object.b);if(p>=object.b||*p++!=':')return (JsonSpan){0,0};p=white(p,object.b);end=json_skip(p,object.b,0);if(!end)return (JsonSpan){0,0};if(match){if(result.a)return (JsonSpan){0,0};result=(JsonSpan){p,end};}p=white(end,object.b);if(p<object.b&&*p==',')p++;else break;}return result;}
