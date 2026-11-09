#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>
#include <shellapi.h>
#include <dcomp.h>
#include <WebView2.h>
#include "webview2-iids.h"
#include "node-runtime-args.h"
#include <atomic>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <deque>
#include <filesystem>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include "../bridge/native-json.h"

namespace {
constexpr wchar_t WidgetUrl[] = L"https://widget.codingschedule.invalid/index.html";
constexpr wchar_t WindowClass[] = L"CodingScheduleWebView2";
constexpr UINT BackendMessage = WM_APP + 1, BackendClosed = WM_APP + 2, TrayMessage = WM_APP + 3, RevealMessage = WM_APP + 4;
constexpr size_t MaxFrame = 2 * 1024 * 1024;
HWND window = nullptr;
HWND previousForeground = nullptr;
IDCompositionDevice* composition = nullptr;
IDCompositionTarget* target = nullptr;
IDCompositionVisual* visual = nullptr;
IDCompositionEffectGroup* effect = nullptr;
ICoreWebView2CompositionController* input = nullptr;
ICoreWebView2Controller* controller = nullptr;
ICoreWebView2* webview = nullptr;
ICoreWebView2_19* memoryTarget = nullptr;
HANDLE childInput = nullptr, childOutput = nullptr, childProcess = nullptr, childJob = nullptr;
std::thread childReader;
std::mutex queueLock;
std::deque<std::string> queue;
size_t queuedBytes = 0;
std::atomic<bool> backendEnded{false};
std::filesystem::path executable, dataDir;
std::atomic<bool> closing{false};
bool probing = false, isolated = false, trackingMouse = false, focusable = false, appReady = false;
bool showRequested = false, trayAdded = false;
POINT previousCursor{LONG_MIN, LONG_MIN};
int result = 1;

std::wstring widen(const std::string& s) {
    int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring out(length, L'\0');
    if (length) MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), out.data(), length);
    return out;
}
std::string utf8(const std::wstring& s) {
    int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), nullptr, 0, nullptr, nullptr);
    std::string out(length, '\0');
    if (length) WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), out.data(), length, nullptr, nullptr);
    return out;
}
std::string quoted(const std::wstring& value) {
    std::string out = "\"";
    for (unsigned char c : utf8(value)) {
        if (c == '"' || c == '\\') out += '\\';
        if (c < 32) {
            char escaped[7];
            snprintf(escaped, sizeof escaped, "\\u%04x", c);
            out += escaped;
        } else out += static_cast<char>(c);
    }
    return out + '"';
}
std::wstring environment(const wchar_t* key) {
    DWORD n = GetEnvironmentVariableW(key, nullptr, 0);
    if (!n) return {};
    std::wstring out(n, L'\0');
    out.resize(GetEnvironmentVariableW(key, out.data(), n));
    return out;
}
JsonSpan span(const std::string& value) { return {value.data(), value.data() + value.size()}; }
std::string raw(JsonSpan value) { return value.a ? std::string(value.a, value.b) : std::string{}; }
std::string word(JsonSpan value) {
    char buffer[80];
    return ascii_string(value, buffer, sizeof buffer) ? buffer : "";
}
double number(JsonSpan value, double fallback = 0) {
    if (!value.a) return fallback;
    std::string text = raw(value);
    char* end = nullptr;
    double v = std::strtod(text.c_str(), &end);
    return end == text.c_str() + text.size() && std::isfinite(v) ? v : fallback;
}
bool truth(JsonSpan value) { return raw(value) == "true"; }
int integer(JsonSpan object, const char* key) {
    return static_cast<int>(std::clamp(number(member(object, key)), -1000000.0, 1000000.0));
}
bool runtimeRegistered() {
    constexpr wchar_t key[] = L"SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    for (HKEY root : {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE}) {
        for (DWORD view : {RRF_SUBKEY_WOW6432KEY, RRF_SUBKEY_WOW6464KEY}) {
            wchar_t version[80]{};
            DWORD length = sizeof version;
            if (RegGetValueW(root, key, L"pv", RRF_RT_REG_SZ | view, nullptr, version, &length) == ERROR_SUCCESS &&
                version[0] && wcscmp(version, L"0.0.0.0")) return true;
        }
    }
    return false;
}
void error(const wchar_t* message, int code = 1) {
    result = code;
    if (!probing && !isolated) MessageBoxW(window, message, L"codingSchedule", MB_OK | MB_ICONERROR);
    PostQuitMessage(result);
}
void send(const std::string& message) {
    if (!childInput || message.size() > MaxFrame) return;
    const std::string line = message + '\n';
    DWORD written = 0;
    if (!WriteFile(childInput, line.data(), static_cast<DWORD>(line.size()), &written, nullptr) || written != line.size()) {
        CloseHandle(childInput);
        childInput = nullptr;
    }
}

UINT monitorDpi(HMONITOR monitor) {
    using GetDpi = HRESULT(WINAPI*)(HMONITOR, int, UINT*, UINT*);
    static HMODULE shcore = LoadLibraryExW(L"shcore.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
    static auto getDpi = shcore ? reinterpret_cast<GetDpi>(GetProcAddress(shcore, "GetDpiForMonitor")) : nullptr;
    UINT x = 96, y = 96;
    if (getDpi) getDpi(monitor, 0, &x, &y);
    return x ? x : 96;
}
RECT logicalRect(const RECT& r, const RECT& monitor, UINT dpi) {
    return {monitor.left + MulDiv(r.left - monitor.left, 96, dpi), monitor.top + MulDiv(r.top - monitor.top, 96, dpi),
            monitor.left + MulDiv(r.right - monitor.left, 96, dpi), monitor.top + MulDiv(r.bottom - monitor.top, 96, dpi)};
}
std::string rectJson(const RECT& rect) {
    return "{\"x\":" + std::to_string(rect.left) + ",\"y\":" + std::to_string(rect.top) +
        ",\"width\":" + std::to_string(rect.right - rect.left) + ",\"height\":" + std::to_string(rect.bottom - rect.top) + "}";
}
BOOL CALLBACK monitorInfo(HMONITOR monitor, HDC, LPRECT, LPARAM context) {
    auto& out = *reinterpret_cast<std::string*>(context);
    MONITORINFO info{sizeof info};
    if (!GetMonitorInfoW(monitor, &info)) return TRUE;
    if (!out.empty()) out += ',';
    auto dpi = monitorDpi(monitor);
    out += "{\"primary\":" + std::string(info.dwFlags & MONITORINFOF_PRIMARY ? "true" : "false") +
        ",\"bounds\":" + rectJson(logicalRect(info.rcMonitor, info.rcMonitor, dpi)) +
        ",\"workArea\":" + rectJson(logicalRect(info.rcWork, info.rcMonitor, dpi)) + "}";
    return TRUE;
}
void screens() {
    std::string out;
    EnumDisplayMonitors(nullptr, nullptr, monitorInfo, reinterpret_cast<LPARAM>(&out));
    send("{\"type\":\"screens\",\"displays\":[" + out + "]}");
}
POINT logicalPoint(POINT physical) {
    auto monitor = MonitorFromPoint(physical, MONITOR_DEFAULTTONEAREST);
    MONITORINFO info{sizeof info};
    if (!GetMonitorInfoW(monitor, &info)) return physical;
    auto dpi = monitorDpi(monitor);
    return {info.rcMonitor.left + MulDiv(physical.x - info.rcMonitor.left, 96, dpi),
            info.rcMonitor.top + MulDiv(physical.y - info.rcMonitor.top, 96, dpi)};
}
void cursor() {
    POINT p{};
    if (!GetCursorPos(&p) || (p.x == previousCursor.x && p.y == previousCursor.y)) return;
    previousCursor = p;
    p = logicalPoint(p);
    send("{\"type\":\"cursor\",\"x\":" + std::to_string(p.x) + ",\"y\":" + std::to_string(p.y) + "}");
}
void bounds(JsonSpan payload) {
    POINT p{integer(payload, "x"), integer(payload, "y")};
    auto monitor = MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST);
    MONITORINFO info{sizeof info};
    if (!GetMonitorInfoW(monitor, &info)) return;
    auto dpi = monitorDpi(monitor);
    int x = info.rcMonitor.left + MulDiv(p.x - info.rcMonitor.left, dpi, 96);
    int y = info.rcMonitor.top + MulDiv(p.y - info.rcMonitor.top, dpi, 96);
    int w = std::clamp(integer(payload, "width"), 1, 10000), h = std::clamp(integer(payload, "height"), 1, 10000);
    SetWindowPos(window, HWND_TOPMOST, x, y, MulDiv(w, dpi, 96), MulDiv(h, dpi, 96), SWP_NOACTIVATE);
}
void shape(JsonSpan list) {
    if (!list.a || *list.a != '[') return;
    const auto dpi = GetDpiForWindow(window);
    HRGN region = CreateRectRgn(0, 0, 0, 0);
    if (!region) return;
    const char* p = white(list.a + 1, list.b);
    json_budget = 32768;
    size_t count = 0;
    while (p < list.b && *p == '{' && count < 10000) {
        const char* end = json_skip(p, list.b, 0);
        if (!end) break;
        JsonSpan row{p, end};
        const int x = integer(row, "x"), y = integer(row, "y");
        const int w = integer(row, "width"), h = integer(row, "height");
        if (w > 0 && h > 0) {
            HRGN part = CreateRectRgn(MulDiv(x, dpi, 96), MulDiv(y, dpi, 96), MulDiv(x+w, dpi, 96), MulDiv(y+h, dpi, 96));
            if (part) { CombineRgn(region, region, part, RGN_OR); DeleteObject(part); ++count; }
        }
        p = white(end, list.b);
        if (p < list.b && *p == ',') p = white(p + 1, list.b); else break;
    }
    if (!count || !SetWindowRgn(window, region, TRUE)) DeleteObject(region);
}
void show() {
    showRequested = true;
    if (appReady) ShowWindow(window, SW_SHOWNOACTIVATE);
}
void backend(const std::string& line) {
    auto root = span(line);
    if (!json_valid(root)) return;
    const auto kind = word(member(root, "type"));
    const auto body = member(root, "payload");
    if (kind == "bounds") bounds(body);
    else if (kind == "shape") shape(body);
    else if (kind == "opacity" && effect) { effect->SetOpacity(static_cast<float>(std::clamp(number(body, 1), 0.4, 1.0))); composition->Commit(); }
    else if (kind == "show") show();
    else if (kind == "hide") { showRequested = false; ShowWindow(window, SW_HIDE); }
    else if (kind == "focusable") {
        focusable = truth(body);
        auto style = GetWindowLongPtrW(window, GWL_EXSTYLE);
        SetWindowLongPtrW(window, GWL_EXSTYLE, focusable ? style & ~WS_EX_NOACTIVATE : style | WS_EX_NOACTIVATE);
        if (!focusable && GetForegroundWindow() == window && IsWindow(previousForeground)) SetForegroundWindow(previousForeground);
    } else if (kind == "focus" && focusable) {
        const auto foreground = GetForegroundWindow();
        if (foreground != window) previousForeground = foreground;
        show(); SetForegroundWindow(window);
        if (controller) controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    } else if ((kind == "emit" || kind == "reply") && webview) {
        webview->PostWebMessageAsJson(widen(line).c_str());
    } else if (kind == "exit") {
        result = integer(root, "code");
        PostQuitMessage(result);
    } else if (kind == "error" && !isolated) {
        MessageBoxW(window, L"请先退出使用同一数据目录的旧版悬浮框，再检查安装文件和数据目录。", L"无法启动 codingSchedule", MB_OK | MB_ICONERROR);
    } else if (kind == "ready") {
        appReady = true;
        if (showRequested) ShowWindow(window, SW_SHOWNOACTIVATE);
    }
}
void readBackend() {
    char buffer[8192];
    DWORD bytes = 0;
    std::string pending;
    bool overflow = false;
    while (ReadFile(childOutput, buffer, sizeof buffer, &bytes, nullptr) && bytes) {
        pending.append(buffer, bytes);
        size_t at;
        while ((at = pending.find('\n')) != std::string::npos) {
            if (at > MaxFrame) { overflow = true; break; }
            {
                std::lock_guard<std::mutex> lock(queueLock);
                if (queuedBytes + at > 2 * MaxFrame || queue.size() >= 256) { overflow = true; break; }
                queue.push_back(pending.substr(0, at));
                queuedBytes += at;
            }
            pending.erase(0, at + 1);
            PostMessageW(window, BackendMessage, 0, 0);
        }
        if (overflow || pending.size() > MaxFrame) break;
    }
    backendEnded = true;
    PostMessageW(window, BackendClosed, 0, 0);
}
std::wstring arg(const std::wstring& value) {
    // File and directory names cannot contain quotes. Double a final backslash.
    return L"\"" + value + (value.empty() || value.back() != L'\\' ? L"\"" : L"\\\"");
}
bool startBackend() {
    const auto root = executable.parent_path() / L"resources";
    const auto node = root / L"bridge-runtime/node.exe";
    const auto script = root / L"webview2/main.cjs";
    HANDLE readIn = nullptr, writeOut = nullptr;
    SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
    if (!CreatePipe(&readIn, &childInput, &sa, 0) || !CreatePipe(&childOutput, &writeOut, &sa, 0)) {
        if (readIn) CloseHandle(readIn);
        if (writeOut) CloseHandle(writeOut);
        return false;
    }
    SetHandleInformation(childInput, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(childOutput, HANDLE_FLAG_INHERIT, 0);
    HANDLE errors = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING, 0, nullptr);
    STARTUPINFOW start{sizeof start};
    start.dwFlags = STARTF_USESTDHANDLES;
    start.hStdInput = readIn;
    start.hStdOutput = writeOut;
    start.hStdError = errors;
    PROCESS_INFORMATION process{};
    auto command = arg(node.wstring()) + ScheduleNodeArgs + L" " + arg(script.wstring()) + L" " + arg(executable.wstring()) + L" " + arg(dataDir.wstring()) + (isolated ? L" --isolated" : L"");
    childJob = CreateJobObjectW(nullptr, nullptr);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    const bool created = childJob && SetInformationJobObject(childJob, JobObjectExtendedLimitInformation, &limits, sizeof limits) &&
        CreateProcessW(node.c_str(), command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, root.c_str(), &start, &process);
    CloseHandle(readIn); CloseHandle(writeOut);
    if (errors != INVALID_HANDLE_VALUE) CloseHandle(errors);
    if (!created) return false;
    childProcess = process.hProcess;
    if (!AssignProcessToJobObject(childJob, childProcess)) {
        TerminateProcess(childProcess, 1); CloseHandle(process.hThread); return false;
    }
    ResumeThread(process.hThread); CloseHandle(process.hThread);
    childReader = std::thread(readBackend);
    screens(); cursor();
    return true;
}

template<class Interface, class F> class Callback final : public Interface {
    ULONG refs = 1;
    F action;
public:
    explicit Callback(F f) : action(f) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override {
        if (!out) return E_POINTER;
        if (IsEqualIID(iid, IID_IUnknown) || IsEqualIID(iid, __uuidof(Interface))) { *out = static_cast<Interface*>(this); AddRef(); return S_OK; }
        *out = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs; }
    ULONG STDMETHODCALLTYPE Release() override { const ULONG left = --refs; if (!left) delete this; return left; }
    template<typename... Args> HRESULT call(Args... args) { return action(args...); }
    HRESULT STDMETHODCALLTYPE Invoke(typename F::First first, typename F::Second second) override { return call(first, second); }
};
template<class FirstT, class SecondT> struct Handler {
    using First = FirstT;
    using Second = SecondT;
    HRESULT (*fn)(First, Second);
    HRESULT operator()(First first, Second second) const { return fn(first, second); }
};
template<class Interface, class A, class B> auto callback(HRESULT (*fn)(A, B)) { return new Callback<Interface, Handler<A, B>>({fn}); }

HRESULT navigation(ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) {
    LPWSTR uri = nullptr;
    args->get_Uri(&uri);
    if (!uri || wcscmp(uri, WidgetUrl)) args->put_Cancel(TRUE);
    CoTaskMemFree(uri);
    return S_OK;
}
HRESULT newWindow(ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) { args->put_Handled(TRUE); return S_OK; }
HRESULT message(ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) {
    LPWSTR source = nullptr, json = nullptr;
    args->get_Source(&source);
    if (source && !wcscmp(source, WidgetUrl) && SUCCEEDED(args->get_WebMessageAsJson(&json)) && json) {
        const auto data = utf8(json);
        if (data.size() <= 16384 && json_valid(span(data))) {
            const bool active = GetForegroundWindow() == window;
            send("{\"type\":\"web\",\"focused\":" + std::string(active ? "true" : "false") + ",\"payload\":" + data + "}");
        }
    }
    CoTaskMemFree(json); CoTaskMemFree(source);
    return S_OK;
}
HRESULT cursorChanged(ICoreWebView2CompositionController* sender, IUnknown*) {
    HCURSOR value = nullptr;
    if (SUCCEEDED(sender->get_Cursor(&value)) && value) SetCursor(value);
    return S_OK;
}
HRESULT controllerCreated(HRESULT status, ICoreWebView2CompositionController* created) {
    if (FAILED(status) || !created) { error(L"WebView2 无法创建窗口。请重新运行安装程序修复运行环境。", 12); return S_OK; }
    input = created; input->AddRef();
    if (FAILED(input->QueryInterface(__uuidof(ICoreWebView2Controller), reinterpret_cast<void**>(&controller)))) {
        error(L"WebView2 窗口接口不可用。", 12); return S_OK;
    }
    ICoreWebView2Controller2* background = nullptr;
    if (FAILED(controller->QueryInterface(__uuidof(ICoreWebView2Controller2), reinterpret_cast<void**>(&background)))) {
        error(L"WebView2 缺少透明窗口能力。", 12); return S_OK;
    }
    const auto transparent = background->put_DefaultBackgroundColor({0, 0, 0, 0});
    background->Release();
    if (FAILED(transparent) || FAILED(input->put_RootVisualTarget(visual)) || FAILED(composition->Commit())) {
        error(L"WebView2 无法启用透明合成窗口。", 12); return S_OK;
    }
    if (FAILED(controller->get_CoreWebView2(&webview)) || !webview) { error(L"WebView2 页面不可用。"); return S_OK; }
    ICoreWebView2_3* assets = nullptr;
    if (FAILED(webview->QueryInterface(__uuidof(ICoreWebView2_3), reinterpret_cast<void**>(&assets)))) {
        error(L"WebView2 缺少本地资源能力。", 12); return S_OK;
    }
    if (probing) { assets->Release(); result = 0; PostQuitMessage(0); return S_OK; }
    const auto mapped = assets->SetVirtualHostNameToFolderMapping(L"widget.codingschedule.invalid", (executable.parent_path() / L"resources/renderer").c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
    assets->Release();
    if (FAILED(mapped)) { error(L"无法加载悬浮窗资源。"); return S_OK; }
    if (SUCCEEDED(webview->QueryInterface(__uuidof(ICoreWebView2_19), reinterpret_cast<void**>(&memoryTarget)))) {
        memoryTarget->put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
    }
    ICoreWebView2Settings* settings = nullptr;
    if (SUCCEEDED(webview->get_Settings(&settings))) {
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_AreDefaultContextMenusEnabled(FALSE);
        settings->put_AreHostObjectsAllowed(FALSE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_IsZoomControlEnabled(FALSE);
        settings->Release();
    }
    EventRegistrationToken token{};
    auto* nav = callback<ICoreWebView2NavigationStartingEventHandler>(navigation);
    auto* popup = callback<ICoreWebView2NewWindowRequestedEventHandler>(newWindow);
    auto* messages = callback<ICoreWebView2WebMessageReceivedEventHandler>(message);
    auto* mouse = callback<ICoreWebView2CursorChangedEventHandler>(cursorChanged);
    const bool handlers = SUCCEEDED(webview->add_NavigationStarting(nav, &token)) &&
        SUCCEEDED(webview->add_NewWindowRequested(popup, &token)) && SUCCEEDED(webview->add_WebMessageReceived(messages, &token)) &&
        SUCCEEDED(input->add_CursorChanged(mouse, &token));
    nav->Release(); popup->Release(); messages->Release(); mouse->Release();
    if (!handlers) { error(L"无法初始化悬浮窗交互。"); return S_OK; }
    RECT client{}; GetClientRect(window, &client); controller->put_Bounds(client);
    controller->put_IsVisible(TRUE);
    if (!startBackend()) { error(L"无法启动应用后台。请通过安装程序修复。"); return S_OK; }
    webview->Navigate(WidgetUrl);
    return S_OK;
}
HRESULT environmentCreated(HRESULT status, ICoreWebView2Environment* environment) {
    ICoreWebView2Environment3* compositionEnv = nullptr;
    LPWSTR version = nullptr;
    bool production = environment && SUCCEEDED(environment->get_BrowserVersionString(&version)) && version &&
        version[0] && wcsspn(version, L"0123456789.") == wcslen(version);
    CoTaskMemFree(version);
    if (FAILED(status) || !production || FAILED(environment->QueryInterface(__uuidof(ICoreWebView2Environment3), reinterpret_cast<void**>(&compositionEnv)))) {
        error(L"WebView2 运行环境未就绪。请通过安装程序修复。", 12); return S_OK;
    }
    auto* done = callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler>(controllerCreated);
    auto hr = compositionEnv->CreateCoreWebView2CompositionController(window, done);
    done->Release(); compositionEnv->Release();
    if (FAILED(hr)) error(L"WebView2 无法初始化窗口。", 12);
    return S_OK;
}

void trayAction(int id) {
    const char* action = nullptr;
    switch (id) {
        case 1: action = "reveal"; break;
        case 2: action = "showFocused"; break;
        case 3: action = "openSettings"; break;
        case 4: action = "appearanceReset"; break;
        case 5: action = "retryCollector"; break;
        case 6: action = "hide"; break;
        case 7: PostMessageW(window, WM_CLOSE, 0, 0); return;
    }
    if (action) send("{\"type\":\"tray\",\"action\":\"" + std::string(action) + "\"}");
}
void trayMenu() {
    HMENU menu = CreatePopupMenu();
    if (!menu) return;
    const wchar_t* labels[] = {L"显示悬浮框", L"展开并聚焦", L"接入 / 设置", L"恢复默认大小与不透明度", L"重新连接采集器", L"隐藏", L"退出"};
    for (int i = 0; i < 7; ++i) AppendMenuW(menu, MF_STRING, i + 1, labels[i]);
    POINT p{}; GetCursorPos(&p);
    SetForegroundWindow(window);
    int id = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON, p.x, p.y, 0, window, nullptr);
    DestroyMenu(menu); PostMessageW(window, WM_NULL, 0, 0);
    trayAction(id);
}
bool forwardMouse(UINT message, WPARAM w, LPARAM l) {
    if (!input) return false;
    switch (message) {
        case WM_MOUSEMOVE: case WM_MOUSELEAVE: case WM_LBUTTONDOWN: case WM_LBUTTONUP:
        case WM_LBUTTONDBLCLK: case WM_RBUTTONDOWN: case WM_RBUTTONUP: case WM_MOUSEWHEEL: case WM_MOUSEHWHEEL: break;
        default: return false;
    }
    POINT p{GET_X_LPARAM(l), GET_Y_LPARAM(l)};
    UINT32 data = 0;
    if (message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL) { ScreenToClient(window, &p); data = GET_WHEEL_DELTA_WPARAM(w); }
    if (message == WM_MOUSEMOVE && !trackingMouse) {
        TRACKMOUSEEVENT track{sizeof track, TME_LEAVE, window, 0};
        trackingMouse = TrackMouseEvent(&track);
    }
    if (message == WM_MOUSELEAVE) { trackingMouse = false; p = {0, 0}; w = 0; }
    if (message == WM_LBUTTONDOWN) SetCapture(window);
    input->SendMouseInput(static_cast<COREWEBVIEW2_MOUSE_EVENT_KIND>(message), static_cast<COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS>(GET_KEYSTATE_WPARAM(w)), data, p);
    if (message == WM_LBUTTONUP && GetCapture() == window) ReleaseCapture();
    return true;
}
LRESULT CALLBACK procedure(HWND hwnd, UINT msg, WPARAM w, LPARAM l) {
    switch (msg) {
        case WM_MOUSEACTIVATE: return focusable ? MA_ACTIVATE : MA_NOACTIVATE;
        case WM_ERASEBKGND: return 1;
        case WM_SIZE: if (controller) { RECT r{}; GetClientRect(hwnd, &r); controller->put_Bounds(r); } return 0;
        case WM_MOVE: if (controller) controller->NotifyParentWindowPositionChanged(); return 0;
        case WM_DPICHANGED: {
            const auto& suggested = *reinterpret_cast<const RECT*>(l);
            SetWindowPos(hwnd, nullptr, suggested.left, suggested.top, suggested.right - suggested.left, suggested.bottom - suggested.top, SWP_NOACTIVATE | SWP_NOZORDER);
            screens();
            return 0;
        }
        case WM_ACTIVATE:
            if (memoryTarget) memoryTarget->put_MemoryUsageTargetLevel(LOWORD(w) == WA_INACTIVE
                ? COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW : COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
            break;
        case WM_DISPLAYCHANGE: case WM_SETTINGCHANGE: screens(); return 0;
        case WM_TIMER:
            if (w == 1) cursor();
            if (w == 2) error(L"等待应用启动超时。", probing ? 12 : 1);
            if (w == 3) PostQuitMessage(0);
            return 0;
        case WM_CLOSE:
            if (!closing.exchange(true)) { send("{\"type\":\"quit\"}"); SetTimer(hwnd, 3, 3500, nullptr); }
            return 0;
        case BackendMessage: {
            std::string data;
            {
                std::lock_guard<std::mutex> lock(queueLock);
                if (queue.empty()) return 0;
                data = std::move(queue.front());
                queuedBytes -= data.size();
                queue.pop_front();
            }
            backend(data);
            if (appReady) KillTimer(hwnd, 2);
            return 0;
        }
        case BackendClosed:
            if (backendEnded) {
                if (closing) PostQuitMessage(0);
                else error(L"采集后台已退出。请重新启动 codingSchedule 或运行安装程序修复。");
            }
            return 0;
        case RevealMessage: trayAction(1); return 0;
        case TrayMessage:
            if (l == WM_RBUTTONUP || l == WM_CONTEXTMENU) trayMenu();
            if (l == WM_LBUTTONUP) trayAction(IsWindowVisible(hwnd) ? 6 : 1);
            return 0;
    }
    if (forwardMouse(msg, w, l)) return 0;
    return DefWindowProcW(hwnd, msg, w, l);
}

int run(HINSTANCE instance) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    wchar_t path[32768];
    const DWORD length = GetModuleFileNameW(nullptr, path, 32768);
    if (!length || length >= 32768) return 1;
    executable = std::wstring(path, length);
    const auto profile = environment(L"USERPROFILE");
    dataDir = std::filesystem::path(profile) / L".coding-schedule";
    int count = 0;
    LPWSTR* args = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!args) return 1;
    for (int i = 1; i < count; ++i) {
        if (!wcscmp(args[i], L"--probe-runtime")) probing = true;
        else if (!wcscmp(args[i], L"--data-dir") && i + 1 < count) { dataDir = args[++i]; isolated = true; }
        else { LocalFree(args); return 2; }
    }
    LocalFree(args);
    if (!dataDir.is_absolute() || (probing && !isolated)) return 2;
    if (!runtimeRegistered()) { error(L"未检测到 WebView2。请通过安装程序补齐运行环境。", 10); return result; }
    // Prevent external WebView overrides from selecting a preview browser or an arbitrary folder.
    for (const auto* name : {L"WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", L"WEBVIEW2_RELEASE_CHANNEL_PREFERENCE", L"WEBVIEW2_USER_DATA_FOLDER", L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", L"WEBVIEW2_CHANNEL_SEARCH_KIND", L"WEBVIEW2_RELEASE_CHANNELS"}) SetEnvironmentVariableW(name, nullptr);
    std::filesystem::create_directories(dataDir);
    dataDir = std::filesystem::weakly_canonical(dataDir);
    std::wstring key = dataDir.wstring();
    CharLowerBuffW(key.data(), static_cast<DWORD>(key.size()));
    unsigned long long hash = 14695981039346656037ull;
    for (wchar_t c : key) hash = (hash ^ c) * 1099511628211ull;
    const auto className = std::wstring(WindowClass) + L"-" + std::to_wstring(hash);
    HANDLE mutex = probing ? nullptr : CreateMutexW(nullptr, FALSE, (L"Local\\CodingScheduleWebView2-" + std::to_wstring(hash)).c_str());
    if (!probing && (!mutex || GetLastError() == ERROR_ALREADY_EXISTS)) {
        if (!mutex) return 3;
        if (const auto existing = FindWindowW(className.c_str(), nullptr)) PostMessageW(existing, RevealMessage, 0, 0);
        CloseHandle(mutex);
        return 0;
    }
    WNDCLASSEXW cls{sizeof cls};
    cls.hInstance = instance; cls.lpfnWndProc = procedure; cls.lpszClassName = className.c_str();
    cls.style = CS_DBLCLKS; cls.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassExW(&cls);
    window = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_NOREDIRECTIONBITMAP, className.c_str(),
        L"codingSchedule", WS_POPUP, 0, 0, 148, 272, nullptr, nullptr, instance, nullptr);
    auto loader = LoadLibraryExW((executable.parent_path() / L"WebView2Loader.dll").c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    using CreateEnvironment = decltype(&CreateCoreWebView2EnvironmentWithOptions);
    auto create = loader ? reinterpret_cast<CreateEnvironment>(GetProcAddress(loader, "CreateCoreWebView2EnvironmentWithOptions")) : nullptr;
    if (!window || !create || FAILED(DCompositionCreateDevice(nullptr, __uuidof(IDCompositionDevice), reinterpret_cast<void**>(&composition))) ||
        FAILED(composition->CreateTargetForHwnd(window, TRUE, &target)) || FAILED(composition->CreateVisual(&visual)) ||
        FAILED(composition->CreateEffectGroup(&effect)) || FAILED(visual->SetEffect(effect)) || FAILED(target->SetRoot(visual))) {
        error(L"无法初始化 WebView2 合成窗口。", 12);
    } else {
        auto* done = callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(environmentCreated);
        auto hr = create(nullptr, (dataDir / L"webview2").c_str(), nullptr, done);
        done->Release();
        if (FAILED(hr)) error(L"无法初始化 WebView2 运行环境。", 12);
    }
    NOTIFYICONDATAW tray{sizeof tray};
    tray.hWnd = window; tray.uID = 1; tray.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    tray.uCallbackMessage = TrayMessage; tray.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    wcscpy(tray.szTip, L"codingSchedule · AI 任务进度");
    if (!probing) trayAdded = Shell_NotifyIconW(NIM_ADD, &tray);
    SetTimer(window, 1, 150, nullptr); SetTimer(window, 2, 20000, nullptr);
    MSG event{};
    while (GetMessageW(&event, nullptr, 0, 0) > 0) { TranslateMessage(&event); DispatchMessageW(&event); }
    closing = true;
    if (trayAdded) Shell_NotifyIconW(NIM_DELETE, &tray);
    if (childInput) CloseHandle(childInput);
    if (childJob) CloseHandle(childJob);
    if (childReader.joinable()) childReader.join();
    if (childOutput) CloseHandle(childOutput);
    if (childProcess) CloseHandle(childProcess);
    if (controller) controller->Close();
    if (memoryTarget) memoryTarget->Release();
    if (webview) webview->Release();
    if (input) input->Release();
    if (controller) controller->Release();
    if (effect) effect->Release();
    if (visual) visual->Release();
    if (target) target->Release();
    if (composition) composition->Release();
    if (window) DestroyWindow(window);
    if (mutex) CloseHandle(mutex);
    return static_cast<int>(event.wParam);
}
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;
    int code = 1;
    try { code = run(instance); } catch (...) { if (!probing && !isolated) MessageBoxW(nullptr, L"无法启动 codingSchedule。请检查安装和数据目录。", L"codingSchedule", MB_OK | MB_ICONERROR); }
    CoUninitialize();
    return code;
}
