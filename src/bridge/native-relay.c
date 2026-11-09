/* Stable Windows MCP facade. Tools come from the official SDK manifest.
 * Backend loss is a tool error, never stdio EOF or an automatic write replay. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <winhttp.h>
#include "native-json.h"
#include "mcp-manifest.h"
#define FRAME_LIMIT 131072
#define BODY_LIMIT 262144
static char frame[FRAME_LIMIT+1],config[65537],http_body[BODY_LIMIT+1],output[2*BODY_LIMIT+65536],chunk[8192];
static WCHAR credential_path[32768],endpoint_path[32768];static char connector[129];static DWORD used;static int output_failed,initialized;
void *memset(void *dst,int value,size_t size){volatile unsigned char *p=dst;while(size--)*p++=(unsigned char)value;return dst;}
void *memcpy(void *dst,const void *src,size_t size){volatile unsigned char *p=dst;const unsigned char *q=src;while(size--)*p++=*q++;return dst;}
static void stop(DWORD code){if(code){const char text[]="codingSchedule MCP unavailable; continue the primary task.\n";DWORD n;WriteFile(GetStdHandle(STD_ERROR_HANDLE),text,sizeof(text)-1,&n,0);}ExitProcess(code);}
static int wide_equal(const WCHAR *a,const WCHAR *b){while(*a&&*a==*b){a++;b++;}return *a==*b;}
static int copy_path(WCHAR *dst,const WCHAR *src){unsigned n=0;while(src[n]&&n<32767){dst[n]=src[n];n++;}dst[n]=0;return !src[n];}
static void bytes(const char *p,DWORD n){if(output_failed||n>sizeof(output)-used){output_failed=1;return;}memcpy(output+used,p,n);used+=n;}
static void text(const char *p){const char *e=p;while(*e)e++;bytes(p,(DWORD)(e-p));}
static void quoted(const char *p,DWORD n){text("\"");for(DWORD i=0;i<n;i++){unsigned char c=(unsigned char)p[i];if(c=='"'||c=='\\'){text("\\");bytes(p+i,1);}else if(c<32){const char digits[]="0123456789abcdef";char escaped[6]={'\\','u','0','0',digits[c>>4],digits[c&15]};bytes(escaped,6);}else bytes(p+i,1);}text("\"");}
static void flush(void){if(output_failed)stop(3);text("\n");DWORD n,offset=0;while(offset<used){if(!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE),output+offset,used-offset,&n,0)||!n)stop(0);offset+=n;}used=0;}
static void begin_reply(JsonSpan id,const char *kind){used=0;output_failed=0;text("{\"jsonrpc\":\"2.0\",\"id\":");if(id.a)bytes(id.a,(DWORD)(id.b-id.a));else text("null");text(kind);}
static void rpc_error(JsonSpan id,const char *code,const char *message){begin_reply(id,",\"error\":{\"code\":");text(code);text(",\"message\":");const char *e=message;while(*e)e++;quoted(message,(DWORD)(e-message));text("}}");flush();}
static int read_config(const WCHAR *path,DWORD *length){HANDLE f=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,0,OPEN_EXISTING,0,0);LARGE_INTEGER size;DWORD n,total=0;if(f==INVALID_HANDLE_VALUE)return 0;if(!GetFileSizeEx(f,&size)||size.QuadPart<2||size.QuadPart>65536){CloseHandle(f);return 0;}while(total<(DWORD)size.QuadPart){if(!ReadFile(f,config+total,(DWORD)size.QuadPart-total,&n,0)||!n){CloseHandle(f);return 0;}total+=n;}CloseHandle(f);config[total]=0;*length=total;return 1;}
static JsonSpan configuration(DWORD n){const char *start=config;if(n>=3&&(unsigned char)start[0]==239&&(unsigned char)start[1]==187&&(unsigned char)start[2]==191)start+=3;return (JsonSpan){start,config+n};}
static int credentials(char *id,char *token){DWORD n;char kind[20];if(!read_config(credential_path,&n))return 0;JsonSpan root=configuration(n);if(!json_valid(root)||!ascii_string(member(root,"kind"),kind,sizeof(kind))||!text_equal(kind,"reporter")||!ascii_string(member(root,"connectorId"),id,129)||!ascii_string(member(root,"token"),token,129)||!text_equal(id,connector))return 0;for(unsigned i=0;id[i];i++)if(!((id[i]>='a'&&id[i]<='z')||(id[i]>='A'&&id[i]<='Z')||(id[i]>='0'&&id[i]<='9')||id[i]=='-'||id[i]=='_'||id[i]=='.'||id[i]==':'))return 0;return id[0]&&token[0];}
static unsigned endpoint_port(void){DWORD n;if(!read_config(endpoint_path,&n))return 0;JsonSpan root=configuration(n);if(!json_valid(root))return 0;JsonSpan port=member(root,"port");if(!port.a||port.a==port.b)return 0;unsigned v=0;for(const char *p=port.a;p<port.b;p++){if(*p<'0'||*p>'9'||v>6553)return 0;v=v*10+(unsigned)(*p-'0');}return v>0&&v<=65535?v:0;}
static void wide_text(WCHAR *out,unsigned *at,const char *s){while(*s)out[(*at)++]=(WCHAR)(unsigned char)*s++;}
static int local_request(const WCHAR *path,JsonSpan body,DWORD *status,DWORD *length){
 char id[129],token[129];if(!credentials(id,token))return 0;unsigned port=endpoint_port();if(!port)return 0;
 HINTERNET session=WinHttpOpen(L"codingSchedule/1",WINHTTP_ACCESS_TYPE_NO_PROXY,0,0,0),connection=0,request=0;int ok=0;DWORD n,flags=WINHTTP_DISABLE_REDIRECTS|WINHTTP_DISABLE_COOKIES|WINHTTP_DISABLE_AUTHENTICATION;unsigned h=0;WCHAR headers[768];DWORD started=GetTickCount();
 if(!session)goto done;WinHttpSetTimeouts(session,300,300,500,500);connection=WinHttpConnect(session,L"127.0.0.1",(INTERNET_PORT)port,0);if(!connection)goto done;request=WinHttpOpenRequest(connection,L"POST",path,0,0,0,0);if(!request)goto done;WinHttpSetOption(request,WINHTTP_OPTION_DISABLE_FEATURE,&flags,sizeof(flags));DWORD header_timeout=700;WinHttpSetOption(request,WINHTTP_OPTION_RECEIVE_RESPONSE_TIMEOUT,&header_timeout,sizeof(header_timeout));
 wide_text(headers,&h,"Content-Type: application/json\r\nX-Connector-Id: ");wide_text(headers,&h,id);wide_text(headers,&h,"\r\nAuthorization: Bearer ");wide_text(headers,&h,token);wide_text(headers,&h,"\r\n");headers[h]=0;
 if(!WinHttpSendRequest(request,headers,h,(void*)body.a,(DWORD)(body.b-body.a),(DWORD)(body.b-body.a),0)||!WinHttpReceiveResponse(request,0))goto done;n=sizeof(*status);if(!WinHttpQueryHeaders(request,WINHTTP_QUERY_STATUS_CODE|WINHTTP_QUERY_FLAG_NUMBER,0,status,&n,0))goto done;*length=0;
 for(;;){DWORD elapsed=GetTickCount()-started;if(elapsed>=2000)goto done;WinHttpSetTimeouts(request,300,300,700,(int)(2000-elapsed));if(!WinHttpReadData(request,http_body+*length,BODY_LIMIT-*length,&n))goto done;if(!n)break;*length+=n;if(*length>=BODY_LIMIT)goto done;}
 http_body[*length]=0;if(!*length||!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,http_body,(int)*length,0,0)||!json_valid((JsonSpan){http_body,http_body+*length}))goto done;ok=1;
 done:if(request)WinHttpCloseHandle(request);if(connection)WinHttpCloseHandle(connection);if(session)WinHttpCloseHandle(session);return ok;
}
static void tool_reply(JsonSpan id,int failed,const char *body,DWORD n){begin_reply(id,",\"result\":{\"content\":[{\"type\":\"text\",\"text\":");quoted(body,n);text("}],\"isError\":");text(failed?"true":"false");text("}}");flush();}
static void process_frame(DWORD n){
 JsonSpan root={frame,frame+n},none={0,0};if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,frame,(int)n,0,0)||!json_valid(root)){rpc_error(none,"-32700","Invalid JSON frame");return;}root.a=white(root.a,root.b);if(root.a>=root.b||*root.a!='{'){rpc_error(none,"-32600","Invalid request");return;}
 JsonSpan id=member(root,"id"),params=member(root,"params");char version[16],method[128];if(!ascii_string(member(root,"jsonrpc"),version,sizeof(version))||!text_equal(version,"2.0")||!ascii_string(member(root,"method"),method,sizeof(method))){rpc_error(none,"-32600","Invalid request");return;}
 if(!id.a)return;
 if(*id.a!='"'&&*id.a!='-'&&(*id.a<'0'||*id.a>'9')){rpc_error(none,"-32600","Invalid request id");return;}
 if(text_equal(method,"ping")){begin_reply(id,",\"result\":{}}");flush();return;}
 if(text_equal(method,"initialize")){
  char requested[40];JsonSpan capabilities=member(params,"capabilities"),client=member(params,"clientInfo"),name=member(client,"name"),version=member(client,"version");if(initialized||!ascii_string(member(params,"protocolVersion"),requested,sizeof(requested))||!capabilities.a||*capabilities.a!='{'||!name.a||*name.a!='"'||!version.a||*version.a!='"'){rpc_error(id,"-32602","Invalid initialization");return;}
  const char *negotiated=MCP_LATEST;for(unsigned i=0;mcp_protocols[i];i++)if(text_equal(requested,mcp_protocols[i]))negotiated=mcp_protocols[i];begin_reply(id,",\"result\":{\"protocolVersion\":");const char *end=negotiated;while(*end)end++;quoted(negotiated,(DWORD)(end-negotiated));text(",");text(MCP_INIT_FIELDS);text("}");flush();initialized=1;return;
 }
 if(!initialized){rpc_error(id,"-32000","Initialize first");return;}
 if(text_equal(method,"tools/list")){begin_reply(id,",\"result\":");text(MCP_TOOLS);text("}");flush();return;}
 if(!text_equal(method,"tools/call")){rpc_error(id,"-32601","Method not found");return;}
 char name[80];JsonSpan arguments=member(params,"arguments");if(!ascii_string(member(params,"name"),name,sizeof(name))||!arguments.a||*arguments.a!='{'||(DWORD)(arguments.b-arguments.a)>65536){rpc_error(id,"-32602","Invalid tool arguments");return;}
 const WCHAR *path=text_equal(name,"progress_begin")?L"/v1/begin":text_equal(name,"progress_report")?L"/v1/report":text_equal(name,"progress_context")?L"/v1/context":text_equal(name,"progress_finish")?L"/v1/finish":0;if(!path){rpc_error(id,"-32602","Unknown tool");return;}
 DWORD status,length;if(!local_request(path,arguments,&status,&length)){const char unavailable[]="{\"error\":\"UNAVAILABLE\",\"message\":\"Progress backend unavailable. Continue the primary task; a later natural report can recover without restarting this MCP connection. Do not loop or replay an uncertain write with a new id.\"}";tool_reply(id,1,unavailable,sizeof(unavailable)-1);return;}
 tool_reply(id,status!=200,http_body,length);
}
void mainCRTStartup(void){
 int count;LPWSTR *args=CommandLineToArgvW(GetCommandLineW(),&count);const WCHAR *credential=0,*endpoint=0,*id=0;for(int i=1;i<count;i++){if(wide_equal(args[i],L"--credential")&&i+1<count)credential=args[++i];else if(wide_equal(args[i],L"--endpoint")&&i+1<count)endpoint=args[++i];else if(wide_equal(args[i],L"--connector")&&i+1<count)id=args[++i];else stop(2);}if(!credential||!endpoint||!id||!copy_path(credential_path,credential)||!copy_path(endpoint_path,endpoint))stop(2);unsigned k=0;while(id[k]&&k<128){if(id[k]>126||id[k]<32)stop(2);connector[k]=(char)id[k];k++;}if(id[k])stop(2);connector[k]=0;LocalFree(args);char checked_id[129],token[129];if(!credentials(checked_id,token))stop(3);
 DWORD n,total=0;int overflow=0;while(ReadFile(GetStdHandle(STD_INPUT_HANDLE),chunk,sizeof(chunk),&n,0)&&n){for(DWORD i=0;i<n;i++){if(chunk[i]=='\n'){if(overflow)rpc_error((JsonSpan){0,0},"-32700","Frame limit exceeded");else if(total)process_frame(total);total=0;overflow=0;}else if(!overflow){if(total>=FRAME_LIMIT)overflow=1;else frame[total++]=chunk[i];}}}stop(0);
}
