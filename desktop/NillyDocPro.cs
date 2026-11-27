// ============================================================================
// NillyDoc Pro — Native Windows Loopback Host (0 MB Background RAM)
// created by Nilly graphics (Sotiris Christos) — https://nillygraphics.com/
// Strictly C# 5 compatible (.NET Framework 4.x csc.exe — zero dependencies)
// ============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("NillyDoc Pro")]
[assembly: AssemblyDescription("Ultra-lightweight Acrobat-style PDF Studio — created by Nilly graphics (Sotiris Christos)")]
[assembly: AssemblyCompany("Nilly graphics (Sotiris Christos) — https://nillygraphics.com/")]
[assembly: AssemblyProduct("NillyDoc Pro")]
[assembly: AssemblyCopyright("Copyright (c) Nilly graphics (Sotiris Christos)")]
[assembly: AssemblyVersion("1.5.5.0")]
[assembly: AssemblyFileVersion("1.5.5.0")]

namespace NillyDocPro
{
    static class Program
    {
        private static string _webRoot;
        private static string _token;
        private static string _currentFilePath;
        private static readonly object _fileLock = new object();

        private static volatile bool _running = true;
        private static volatile bool _sawClient = false;
        private static volatile bool _byeReceived = false;
        private static int _activeBusyOps = 0;
        private static long _lastPingTicks = DateTime.UtcNow.Ticks;
        private static long _byeTicks = 0;
        private static long _startTicks = DateTime.UtcNow.Ticks;

        private static TcpListener _listener;

        [STAThread]
        static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool testServerMode = false;
            string infoFile = null;
            string inputPdf = null;

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (string.Equals(a, "--test-server", StringComparison.OrdinalIgnoreCase))
                {
                    testServerMode = true;
                }
                else if (string.Equals(a, "--info-file", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    infoFile = args[++i];
                }
                else if (!a.StartsWith("--") && inputPdf == null)
                {
                    inputPdf = a;
                }
            }

            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            _webRoot = Path.GetFullPath(Path.Combine(exeDir, "web"));
            if (!Directory.Exists(_webRoot))
            {
                string parentWeb = Path.GetFullPath(Path.Combine(exeDir, "..\\web"));
                if (Directory.Exists(parentWeb)) _webRoot = parentWeb;
            }

            if (!File.Exists(Path.Combine(_webRoot, "index.html")))
            {
                if (!testServerMode)
                {
                    MessageBox.Show(
                        "Δεν βρέθηκε ο φάκελος web\\index.html δίπλα στο NillyDocPro.exe.",
                        "NillyDoc Pro — Nilly graphics",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }
                return 2;
            }

            if (!string.IsNullOrEmpty(inputPdf))
            {
                try
                {
                    string full = Path.GetFullPath(inputPdf);
                    if (File.Exists(full)) _currentFilePath = full;
                }
                catch { }
            }

            _token = GenerateToken();
            int port = StartLoopbackListener();
            if (port <= 0)
            {
                if (!testServerMode)
                {
                    MessageBox.Show(
                        "Αδυναμία εκκίνησης τοπικού loopback port (127.0.0.1).",
                        "NillyDoc Pro",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }
                return 3;
            }

            string appUrl = "http://127.0.0.1:" + port + "/?t=" + _token + "&desktop=1";

            if (!string.IsNullOrEmpty(infoFile))
            {
                try { File.WriteAllText(infoFile, appUrl, Encoding.UTF8); } catch { }
            }

            Thread acceptThread = new Thread(AcceptLoop);
            acceptThread.IsBackground = true;
            acceptThread.Start();

            if (!testServerMode)
            {
                LaunchAppWindow(appUrl);
            }

            // Watchdog loop: exit cleanly to 0 MB RAM when the window closes
            while (_running)
            {
                Thread.Sleep(500);
                DateTime now = DateTime.UtcNow;

                if (_byeReceived)
                {
                    DateTime byeAt = new DateTime(Interlocked.Read(ref _byeTicks), DateTimeKind.Utc);
                    if ((now - byeAt).TotalSeconds >= 2.2)
                    {
                        _running = false;
                        break;
                    }
                }

                if (_sawClient && Interlocked.CompareExchange(ref _activeBusyOps, 0, 0) == 0)
                {
                    DateTime lastPing = new DateTime(Interlocked.Read(ref _lastPingTicks), DateTimeKind.Utc);
                    if ((now - lastPing).TotalSeconds >= 25.0)
                    {
                        _running = false;
                        break;
                    }
                }
                else
                {
                    DateTime started = new DateTime(Interlocked.Read(ref _startTicks), DateTimeKind.Utc);
                    if ((now - started).TotalSeconds >= (testServerMode ? 120.0 : 45.0))
                    {
                        _running = false;
                        break;
                    }
                }
            }

            try { _listener.Stop(); } catch { }
            return 0;
        }

        private static string GenerateToken()
        {
            byte[] buf = new byte[16];
            using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider())
            {
                rng.GetBytes(buf);
            }
            StringBuilder sb = new StringBuilder(32);
            for (int i = 0; i < buf.Length; i++) sb.Append(buf[i].ToString("x2"));
            return sb.ToString();
        }

        // Prefer fixed port 17921 so localStorage (saved signatures + theme) persists across sessions!
        // Falls back cleanly to 17922..17940 or OS ephemeral port if multiple PDF windows are open.
        private static int StartLoopbackListener()
        {
            for (int p = 17921; p <= 17940; p++)
            {
                try
                {
                    TcpListener l = new TcpListener(IPAddress.Loopback, p);
                    l.Start();
                    _listener = l;
                    return p;
                }
                catch { }
            }
            try
            {
                TcpListener l = new TcpListener(IPAddress.Loopback, 0);
                l.Start();
                _listener = l;
                return ((IPEndPoint)l.LocalEndpoint).Port;
            }
            catch
            {
                return -1;
            }
        }

        private static void LaunchAppWindow(string url)
        {
            string browser = FindChromiumBrowser();
            if (!string.IsNullOrEmpty(browser))
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = browser;
                    psi.Arguments = "--app=\"" + url + "\" --window-size=1280,860";
                    psi.UseShellExecute = false;
                    Process.Start(psi);
                    StartTaskbarIconSync();
                    return;
                }
                catch { }
            }

            // Fallback: default Windows browser
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch { }
        }

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
        [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
        [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr CreateIconFromResourceEx(byte[] presbits, uint dwResSize, bool fIcon, uint dwVer, int cxDesired, int cyDesired, uint Flags);
        [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll")] private static extern bool SetProcessWorkingSetSize(IntPtr hProcess, IntPtr minSize, IntPtr maxSize);

        private static void TrimMemory()
        {
            try
            {
                GC.Collect(GC.MaxGeneration, GCCollectionMode.Optimized, false);
                SetProcessWorkingSetSize(GetCurrentProcess(), (IntPtr)(-1), (IntPtr)(-1));
            }
            catch { }
        }

        private static IntPtr CreateHIconFromIcoBytes(byte[] icoData, int desiredSize)
        {
            if (icoData == null || icoData.Length < 22) return IntPtr.Zero;
            int count = BitConverter.ToUInt16(icoData, 4);
            if (count <= 0 || count > 32) return IntPtr.Zero;
            int bestIdx = 0;
            int bestDiff = int.MaxValue;
            for (int i = 0; i < count; i++)
            {
                int off = 6 + i * 16;
                if (off + 16 > icoData.Length) break;
                int w = icoData[off];
                if (w == 0) w = 256;
                int diff = Math.Abs(w - desiredSize);
                if (w >= desiredSize && diff < bestDiff) { bestDiff = diff; bestIdx = i; }
                else if (bestDiff == int.MaxValue && diff < bestDiff) { bestDiff = diff; bestIdx = i; }
            }
            int eOff = 6 + bestIdx * 16;
            int len = BitConverter.ToInt32(icoData, eOff + 8);
            int imgOff = BitConverter.ToInt32(icoData, eOff + 12);
            if (len <= 0 || imgOff < 0 || imgOff + len > icoData.Length) return IntPtr.Zero;
            byte[] slice = new byte[len];
            Buffer.BlockCopy(icoData, imgOff, slice, 0, len);
            return CreateIconFromResourceEx(slice, (uint)len, true, 0x00030000, desiredSize, desiredSize, 0);
        }

        private static void StartTaskbarIconSync()
        {
            Thread t = new Thread(delegate()
            {
                try
                {
                    string icoPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "NillyDocPro.ico");
                    if (!File.Exists(icoPath)) icoPath = Path.Combine(_webRoot, "favicon.ico");
                    if (!File.Exists(icoPath)) return;
                    byte[] icoBytes = File.ReadAllBytes(icoPath);
                    IntPtr hBig = CreateHIconFromIcoBytes(icoBytes, 48);
                    IntPtr hSmall = CreateHIconFromIcoBytes(icoBytes, 16);
                    if (hBig == IntPtr.Zero && hSmall == IntPtr.Zero) return;

                    // Re-apply periodically during startup so Edge's favicon load never overrides the crisp unified amber icon
                    for (int attempt = 0; attempt < 25 && _running; attempt++)
                    {
                        Thread.Sleep(attempt < 8 ? 250 : 600);
                        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
                        {
                            if (!IsWindowVisible(hWnd)) return true;
                            StringBuilder sb = new StringBuilder(256);
                            if (GetWindowText(hWnd, sb, sb.Capacity) <= 0) return true;
                            string title = sb.ToString();
                            if (title.IndexOf("NillyDoc Pro", StringComparison.OrdinalIgnoreCase) >= 0)
                            {
                                IntPtr res;
                                if (hBig != IntPtr.Zero) SendMessageTimeout(hWnd, 0x0080, (IntPtr)1, hBig, 0x0002, 200, out res);
                                if (hSmall != IntPtr.Zero) SendMessageTimeout(hWnd, 0x0080, (IntPtr)0, hSmall, 0x0002, 200, out res);
                            }
                            return true;
                        }, IntPtr.Zero);
                    }
                }
                catch { }
            });
            t.IsBackground = true;
            t.Start();
        }

        private static string FindChromiumBrowser()
        {
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            string[] candidates = new string[]
            {
                Path.Combine(pf86, "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(pf,   "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(pf,   "BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
                Path.Combine(pf86, "BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
                Path.Combine(local,"BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
                Path.Combine(pf,   "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(pf86, "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(local,"Google\\Chrome\\Application\\chrome.exe")
            };

            for (int i = 0; i < candidates.Length; i++)
            {
                if (!string.IsNullOrEmpty(candidates[i]) && File.Exists(candidates[i]))
                {
                    return candidates[i];
                }
            }
            return null;
        }

        private static void AcceptLoop()
        {
            while (_running)
            {
                try
                {
                    TcpClient client = _listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(HandleClient, client);
                }
                catch
                {
                    if (!_running) break;
                }
            }
        }

        private static void HandleClient(object obj)
        {
            TcpClient client = (TcpClient)obj;
            try
            {
                client.ReceiveTimeout = 30000;
                client.SendTimeout = 30000;

                using (client)
                using (NetworkStream stream = client.GetStream())
                {
                    HttpRequest req = ReadHttpRequest(stream);
                    if (req == null) return;

                    if (req.Path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
                    {
                        HandleApi(client, stream, req);
                    }
                    else
                    {
                        HandleStaticFile(stream, req);
                    }
                }
            }
            catch { }
        }

        private class HttpRequest
        {
            public string Method;
            public string Path;
            public Dictionary<string, string> Query = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            public byte[] Body;
        }

        private static HttpRequest ReadHttpRequest(NetworkStream stream)
        {
            MemoryStream headerBuf = new MemoryStream();
            byte[] buf = new byte[8192];
            int headerEnd = -1;

            while (headerBuf.Length < 65536)
            {
                int n = stream.Read(buf, 0, buf.Length);
                if (n <= 0) return null;
                headerBuf.Write(buf, 0, n);
                byte[] arr = headerBuf.ToArray();
                headerEnd = FindHeaderEnd(arr);
                if (headerEnd >= 0) break;
            }
            if (headerEnd < 0) return null;

            byte[] all = headerBuf.ToArray();
            string headerText = Encoding.ASCII.GetString(all, 0, headerEnd);
            string[] lines = headerText.Split(new string[] { "\r\n" }, StringSplitOptions.None);
            if (lines.Length == 0) return null;

            string[] reqParts = lines[0].Split(' ');
            if (reqParts.Length < 2) return null;

            HttpRequest req = new HttpRequest();
            req.Method = reqParts[0].ToUpperInvariant();
            string rawTarget = reqParts[1];
            int qIdx = rawTarget.IndexOf('?');
            if (qIdx >= 0)
            {
                req.Path = rawTarget.Substring(0, qIdx);
                ParseQuery(rawTarget.Substring(qIdx + 1), req.Query);
            }
            else
            {
                req.Path = rawTarget;
            }

            for (int i = 1; i < lines.Length; i++)
            {
                int col = lines[i].IndexOf(':');
                if (col > 0)
                {
                    string k = lines[i].Substring(0, col).Trim();
                    string v = lines[i].Substring(col + 1).Trim();
                    req.Headers[k] = v;
                }
            }

            string expectVal;
            if (req.Headers.TryGetValue("Expect", out expectVal) &&
                expectVal.IndexOf("100-continue", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                byte[] cont = Encoding.ASCII.GetBytes("HTTP/1.1 100 Continue\r\n\r\n");
                stream.Write(cont, 0, cont.Length);
            }

            int contentLen = 0;
            string lenVal;
            if (req.Headers.TryGetValue("Content-Length", out lenVal))
            {
                int.TryParse(lenVal, out contentLen);
            }

            int bodyStart = headerEnd + 4;
            int alreadyRead = all.Length - bodyStart;

            if (contentLen > 0)
            {
                if (contentLen > 250 * 1024 * 1024) return null; // 250 MB safety cap
                byte[] body = new byte[contentLen];
                int copied = Math.Min(alreadyRead, contentLen);
                if (copied > 0) Buffer.BlockCopy(all, bodyStart, body, 0, copied);
                int offset = copied;
                while (offset < contentLen)
                {
                    int n = stream.Read(body, offset, contentLen - offset);
                    if (n <= 0) break;
                    offset += n;
                }
                req.Body = body;
            }
            else
            {
                req.Body = new byte[0];
            }

            return req;
        }

        private static int FindHeaderEnd(byte[] arr)
        {
            for (int i = 0; i <= arr.Length - 4; i++)
            {
                if (arr[i] == 13 && arr[i + 1] == 10 && arr[i + 2] == 13 && arr[i + 3] == 10)
                    return i;
            }
            return -1;
        }

        private static void ParseQuery(string qs, Dictionary<string, string> dest)
        {
            string[] pairs = qs.Split('&');
            for (int i = 0; i < pairs.Length; i++)
            {
                if (string.IsNullOrEmpty(pairs[i])) continue;
                int eq = pairs[i].IndexOf('=');
                if (eq >= 0)
                {
                    string k = Uri.UnescapeDataString(pairs[i].Substring(0, eq).Replace('+', ' '));
                    string v = Uri.UnescapeDataString(pairs[i].Substring(eq + 1).Replace('+', ' '));
                    dest[k] = v;
                }
                else
                {
                    dest[Uri.UnescapeDataString(pairs[i])] = "";
                }
            }
        }

        private static bool VerifyToken(HttpRequest req)
        {
            string t;
            if (!req.Query.TryGetValue("t", out t) || string.IsNullOrEmpty(t) || t.Length != _token.Length)
                return false;
            int diff = 0;
            for (int i = 0; i < _token.Length; i++) diff |= (t[i] ^ _token[i]);
            return diff == 0;
        }

        private static void HandleApi(TcpClient client, NetworkStream stream, HttpRequest req)
        {
            if (!VerifyToken(req))
            {
                SendResponse(stream, 403, "Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Invalid token"), null);
                return;
            }

            // Every valid authenticated API call keeps the session alive
            if (!string.Equals(req.Path, "/api/bye", StringComparison.OrdinalIgnoreCase))
            {
                _sawClient = true;
                _byeReceived = false;
                Interlocked.Exchange(ref _lastPingTicks, DateTime.UtcNow.Ticks);
            }

            if (string.Equals(req.Path, "/api/heartbeat", StringComparison.OrdinalIgnoreCase))
            {
                SendResponse(stream, 204, "No Content", null, null, null);
                return;
            }

            if (string.Equals(req.Path, "/api/bye", StringComparison.OrdinalIgnoreCase))
            {
                _sawClient = true;
                _byeReceived = true;
                Interlocked.Exchange(ref _byeTicks, DateTime.UtcNow.Ticks);
                SendResponse(stream, 204, "No Content", null, null, null);
                return;
            }

            if (string.Equals(req.Path, "/api/file", StringComparison.OrdinalIgnoreCase))
            {
                string path;
                lock (_fileLock) { path = _currentFilePath; }
                if (string.IsNullOrEmpty(path) || !File.Exists(path))
                {
                    SendResponse(stream, 204, "No Content", null, null, null);
                    return;
                }
                byte[] data = File.ReadAllBytes(path);
                Dictionary<string, string> extra = new Dictionary<string, string>();
                extra["X-File-Name"] = Uri.EscapeDataString(Path.GetFileName(path));
                SendResponse(stream, 200, "OK", "application/pdf", data, extra);
                return;
            }

            if (string.Equals(req.Path, "/api/save", StringComparison.OrdinalIgnoreCase) && req.Method == "POST")
            {
                string target;
                lock (_fileLock) { target = _currentFilePath; }
                if (string.IsNullOrEmpty(target))
                {
                    HandleSaveAs(client, stream, req);
                    return;
                }
                Interlocked.Increment(ref _activeBusyOps);
                try
                {
                    AtomicWriteFile(target, req.Body);
                    Dictionary<string, string> extra = new Dictionary<string, string>();
                    extra["X-Saved-Name"] = Uri.EscapeDataString(Path.GetFileName(target));
                    SendResponse(stream, 200, "OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("SAVED"), extra);
                }
                catch (Exception ex)
                {
                    SendResponse(stream, 500, "Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(ex.Message), null);
                }
                finally
                {
                    Interlocked.Exchange(ref _lastPingTicks, DateTime.UtcNow.Ticks);
                    Interlocked.Decrement(ref _activeBusyOps);
                    TrimMemory();
                }
                return;
            }

            if (string.Equals(req.Path, "/api/saveas", StringComparison.OrdinalIgnoreCase) && req.Method == "POST")
            {
                HandleSaveAs(client, stream, req);
                return;
            }

            if (string.Equals(req.Path, "/api/reveal", StringComparison.OrdinalIgnoreCase) && req.Method == "POST")
            {
                string target;
                lock (_fileLock) { target = _currentFilePath; }
                if (!string.IsNullOrEmpty(target) && File.Exists(target))
                {
                    string filesExe = FindSiblingExe("NillyFilesPro", "NillyFilesPro.exe");
                    if (filesExe != null)
                        try { Process.Start(new ProcessStartInfo(filesExe, "\"" + Path.GetDirectoryName(target) + "\"") { WorkingDirectory = Path.GetDirectoryName(filesExe), UseShellExecute = true }); } catch { }
                    else
                        try { Process.Start("explorer.exe", "/select,\"" + target + "\""); } catch { }
                }
                SendResponse(stream, 204, "No Content", null, null, null);
                return;
            }

            if (string.Equals(req.Path, "/api/send-note", StringComparison.OrdinalIgnoreCase) && req.Method == "POST")
            {
                string txt = (req.Body != null && req.Body.Length > 0) ? Encoding.UTF8.GetString(req.Body) : "";
                string noteExe = FindSiblingExe("NillyNotePro", "NillyNotePro.exe");
                if (noteExe != null && !string.IsNullOrEmpty(txt))
                {
                    try
                    {
                        string tmp = Path.Combine(Path.GetTempPath(), "NillyDoc_Prepress_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".txt");
                        File.WriteAllText(tmp, txt, new UTF8Encoding(false));
                        Process.Start(new ProcessStartInfo(noteExe, "\"" + tmp + "\"") { WorkingDirectory = Path.GetDirectoryName(noteExe), UseShellExecute = true });
                        SendResponse(stream, 200, "OK", "text/plain", Encoding.ASCII.GetBytes("NOTE"), null);
                        return;
                    }
                    catch { }
                }
                SendResponse(stream, 204, "No Content", null, null, null);
                return;
            }

            if (string.Equals(req.Path, "/api/update-info", StringComparison.OrdinalIgnoreCase))
            {
                string curT, newT;
                bool avail = false;
                try { avail = SuiteUpdater.CheckForUpdate("nillydoc-pro", out curT, out newT); } catch { curT = ""; newT = ""; }
                string j = avail
                    ? ("{\"available\":true,\"current\":\"" + (curT ?? "") + "\",\"latest\":\"" + (newT ?? "") + "\"}")
                    : "{\"available\":false}";
                SendResponse(stream, 200, "OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(j), null);
                return;
            }

            if (string.Equals(req.Path, "/api/update-apply", StringComparison.OrdinalIgnoreCase) && req.Method == "POST")
            {
                SendResponse(stream, 200, "OK", "text/plain", Encoding.ASCII.GetBytes("UPDATING"), null);
                System.Threading.Thread uth = new System.Threading.Thread(delegate()
                {
                    try { SuiteUpdater.ApplySelfUpdate("nillydoc-pro", "NillyDoc-Pro", "Install_NillyDocPro.ps1", null, delegate { System.Environment.Exit(0); }); }
                    catch { }
                });
                uth.IsBackground = true;
                uth.Start();
                return;
            }
            if (string.Equals(req.Path, "/api/suite-theme", StringComparison.OrdinalIgnoreCase))
            {
                string th = ReadSuiteTheme();
                if (!string.IsNullOrEmpty(th)) SendResponse(stream, 200, "OK", "text/plain", Encoding.ASCII.GetBytes(th), null);
                else SendResponse(stream, 204, "No Content", null, null, null);
                return;
            }

            SendResponse(stream, 404, "Not Found", "text/plain", Encoding.ASCII.GetBytes("Not found"), null);
        }

        private static string FindSiblingExe(string folder, string exeName)
        {
            try
            {
                string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"NillySuite\" + folder + @"\" + exeName);
                if (File.Exists(appData)) return appData;
                DirectoryInfo par = Directory.GetParent(AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'));
                if (par != null)
                {
                    string sib = Path.Combine(Path.Combine(par.FullName, folder), exeName);
                    if (File.Exists(sib)) return sib;
                }
            }
            catch { }
            return null;
        }

        private static string ReadSuiteTheme()
        {
            try
            {
                string p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"NillySuite\suite.theme");
                if (File.Exists(p))
                {
                    string s = File.ReadAllText(p, Encoding.ASCII).Trim().ToLowerInvariant();
                    if (s == "light" || s == "dark") return s;
                }
            }
            catch { }
            return null;
        }

        private static void HandleSaveAs(TcpClient client, NetworkStream stream, HttpRequest req)
        {
            Interlocked.Increment(ref _activeBusyOps);
            try
            {
                try { client.SendTimeout = 0; client.ReceiveTimeout = 600000; } catch { }

                string suggested = "document.pdf";
                string qName;
                if (req.Query.TryGetValue("name", out qName) && !string.IsNullOrEmpty(qName))
                {
                    suggested = Path.GetFileName(qName);
                }

                string chosenPath = null;
                string initialDir = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
                lock (_fileLock)
                {
                    if (!string.IsNullOrEmpty(_currentFilePath))
                    {
                        string d = Path.GetDirectoryName(_currentFilePath);
                        if (!string.IsNullOrEmpty(d) && Directory.Exists(d)) initialDir = d;
                    }
                }

                Thread sta = new Thread(delegate()
                {
                    try
                    {
                        using (Form owner = new Form())
                        {
                            owner.FormBorderStyle = FormBorderStyle.None;
                            owner.ShowInTaskbar = false;
                            owner.StartPosition = FormStartPosition.CenterScreen;
                            owner.Size = new System.Drawing.Size(1, 1);
                            owner.Opacity = 0.0;
                            owner.TopMost = true;
                            owner.Show();
                            owner.Activate();
                            try { SetForegroundWindow(owner.Handle); } catch { }

                            using (SaveFileDialog dlg = new SaveFileDialog())
                            {
                                dlg.Title = "NillyDoc Pro — Αποθήκευση PDF";
                                dlg.Filter = "PDF Document (*.pdf)|*.pdf";
                                dlg.DefaultExt = "pdf";
                                dlg.AddExtension = true;
                                dlg.OverwritePrompt = true;
                                dlg.InitialDirectory = initialDir;
                                dlg.FileName = suggested;
                                if (dlg.ShowDialog(owner) == DialogResult.OK)
                                {
                                    chosenPath = dlg.FileName;
                                }
                            }
                            owner.Close();
                        }
                    }
                    catch { }
                });
                sta.SetApartmentState(ApartmentState.STA);
                sta.Start();
                sta.Join();

                if (string.IsNullOrEmpty(chosenPath))
                {
                    SendResponse(stream, 204, "No Content", "text/plain", Encoding.ASCII.GetBytes("CANCELLED"), null);
                    return;
                }

                try
                {
                    AtomicWriteFile(chosenPath, req.Body);
                    lock (_fileLock) { _currentFilePath = chosenPath; }
                    Dictionary<string, string> extra = new Dictionary<string, string>();
                    extra["X-Saved-Name"] = Uri.EscapeDataString(Path.GetFileName(chosenPath));
                    SendResponse(stream, 200, "OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("SAVED"), extra);
                }
                catch (Exception ex)
                {
                    SendResponse(stream, 500, "Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(ex.Message), null);
                }
            }
            finally
            {
                Interlocked.Exchange(ref _lastPingTicks, DateTime.UtcNow.Ticks);
                Interlocked.Decrement(ref _activeBusyOps);
                TrimMemory();
            }
        }

        private static void AtomicWriteFile(string targetPath, byte[] data)
        {
            string tmp = targetPath + ".nillytmp";
            File.WriteAllBytes(tmp, data);
            if (File.Exists(targetPath))
            {
                try
                {
                    File.Replace(tmp, targetPath, null);
                }
                catch
                {
                    File.Copy(tmp, targetPath, true);
                    try { File.Delete(tmp); } catch { }
                }
            }
            else
            {
                File.Move(tmp, targetPath);
            }
        }

        private static void HandleStaticFile(NetworkStream stream, HttpRequest req)
        {
            string rel = req.Path;
            if (string.IsNullOrEmpty(rel) || rel == "/") rel = "/index.html";
            rel = Uri.UnescapeDataString(rel).TrimStart('/').Replace('/', '\\');

            string full = Path.GetFullPath(Path.Combine(_webRoot, rel));
            string rootWithSep = _webRoot.EndsWith("\\") ? _webRoot : _webRoot + "\\";
            if (!full.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
            {
                SendResponse(stream, 404, "Not Found", "text/plain", Encoding.ASCII.GetBytes("404 Not Found"), null);
                return;
            }

            byte[] bytes = File.ReadAllBytes(full);
            string mime = GetMimeType(Path.GetExtension(full));
            SendResponse(stream, 200, "OK", mime, bytes, null);
        }

        private static string GetMimeType(string ext)
        {
            string e = (ext ?? "").ToLowerInvariant();
            if (e == ".html") return "text/html; charset=utf-8";
            if (e == ".css") return "text/css; charset=utf-8";
            if (e == ".js") return "application/javascript; charset=utf-8";
            if (e == ".json") return "application/json; charset=utf-8";
            if (e == ".svg") return "image/svg+xml";
            if (e == ".png") return "image/png";
            if (e == ".ico") return "image/x-icon";
            if (e == ".pdf") return "application/pdf";
            return "application/octet-stream";
        }

        private static void SendResponse(
            NetworkStream stream,
            int status,
            string reason,
            string contentType,
            byte[] body,
            Dictionary<string, string> extraHeaders)
        {
            int len = body != null ? body.Length : 0;
            StringBuilder sb = new StringBuilder();
            sb.Append("HTTP/1.1 ").Append(status).Append(' ').Append(reason).Append("\r\n");
            if (!string.IsNullOrEmpty(contentType))
                sb.Append("Content-Type: ").Append(contentType).Append("\r\n");
            sb.Append("Content-Length: ").Append(len).Append("\r\n");
            sb.Append("Cache-Control: no-store\r\n");
            sb.Append("Connection: close\r\n");
            if (extraHeaders != null)
            {
                foreach (KeyValuePair<string, string> kv in extraHeaders)
                    sb.Append(kv.Key).Append(": ").Append(kv.Value).Append("\r\n");
            }
            sb.Append("\r\n");

            byte[] hdr = Encoding.ASCII.GetBytes(sb.ToString());
            stream.Write(hdr, 0, hdr.Length);
            if (body != null && len > 0)
            {
                stream.Write(body, 0, len);
            }
            stream.Flush();
        }
    }

    internal static class SuiteUpdater
    {
        private const string CATALOG_URL = "https://raw.githubusercontent.com/nillynp/nillyhub/main/catalog.json";

        private static bool TryParseVer(string raw, out System.Version ver)
        {
            ver = null;
            if (string.IsNullOrEmpty(raw)) return false;
            string s = raw.Trim();
            if (s.StartsWith("v", System.StringComparison.OrdinalIgnoreCase)) s = s.Substring(1);
            string[] p = s.Split('.');
            if (p.Length < 2 || p.Length > 4) return false;
            int maj, min, pat = 0;
            if (!int.TryParse(p[0], System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out maj)) return false;
            if (!int.TryParse(p[1], System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out min)) return false;
            if (p.Length >= 3 && !int.TryParse(p[2], System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out pat)) return false;
            ver = new System.Version(maj, min, pat, 0);
            return true;
        }

        private static string FmtVer(System.Version v)
        {
            return v.Build > 0
                ? string.Format(System.Globalization.CultureInfo.InvariantCulture, "v{0}.{1}.{2}", v.Major, v.Minor, v.Build)
                : string.Format(System.Globalization.CultureInfo.InvariantCulture, "v{0}.{1}", v.Major, v.Minor);
        }

        public static bool CheckForUpdate(string repoName, out string curTag, out string newTag)
        {
            curTag = null; newTag = null;
            System.Version rawCur = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
            System.Version curVer = new System.Version(rawCur.Major, rawCur.Minor, rawCur.Build >= 0 ? rawCur.Build : 0, 0);
            curTag = FmtVer(curVer);

            string suiteDir = System.IO.Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData), "NillySuite");
            string cachePath = System.IO.Path.Combine(suiteDir, ".nillyhub_catalog.json");
            string json = null;
            try
            {
                if (System.IO.File.Exists(cachePath))
                {
                    System.DateTime wt = System.IO.File.GetLastWriteTimeUtc(cachePath);
                    if ((System.DateTime.UtcNow - wt).TotalHours < 24.0)
                    {
                        string cached = System.IO.File.ReadAllText(cachePath, System.Text.Encoding.UTF8);
                        if (cached.IndexOf("\"latestVersion\"", System.StringComparison.Ordinal) >= 0) json = cached;
                    }
                }
            }
            catch { }

            if (string.IsNullOrEmpty(json))
            {
                json = HttpGetText(CATALOG_URL, 5000);
                if (string.IsNullOrEmpty(json) || json.Length > 256 * 1024) return false;
                try
                {
                    System.IO.Directory.CreateDirectory(suiteDir);
                    System.IO.File.WriteAllText(cachePath, json, new System.Text.UTF8Encoding(false));
                }
                catch { }
            }

            System.Text.RegularExpressions.Match m = System.Text.RegularExpressions.Regex.Match(
                json,
                "\"repo\"\\s*:\\s*\"" + System.Text.RegularExpressions.Regex.Escape(repoName) + "\"[^\\}]{0,500}?\"latestVersion\"\\s*:\\s*\"(v[0-9]+\\.[0-9]+(?:\\.[0-9]+)?)\"",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!m.Success) return false;
            System.Version remVer;
            if (!TryParseVer(m.Groups[1].Value, out remVer) || remVer <= curVer) return false;
            newTag = FmtVer(remVer);
            return true;
        }

        private static string HttpGetText(string url, int timeoutMs)
        {
            try { System.Net.ServicePointManager.SecurityProtocol |= (System.Net.SecurityProtocolType)3072 | System.Net.SecurityProtocolType.Tls12; } catch { }
            System.Net.HttpWebRequest req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(url);
            req.UserAgent = "NillySuite-Updater/1.0 (https://nillygraphics.com/)";
            req.Accept = "application/vnd.github+json, application/json";
            req.AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate;
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            using (System.Net.HttpWebResponse resp = (System.Net.HttpWebResponse)req.GetResponse())
            using (System.IO.Stream st = resp.GetResponseStream())
            using (System.IO.StreamReader sr = new System.IO.StreamReader(st, System.Text.Encoding.UTF8))
                return sr.ReadToEnd();
        }

        private static string ExtractAssetBlock(string json, string assetName)
        {
            System.Text.RegularExpressions.Match m = System.Text.RegularExpressions.Regex.Match(
                json, "\"name\"\\s*:\\s*\"" + System.Text.RegularExpressions.Regex.Escape(assetName) + "\"");
            if (!m.Success) return null;
            int start = m.Index;
            int depth = 0;
            while (start > 0)
            {
                char c = json[start];
                if (c == '}') depth++;
                else if (c == '{') { if (depth == 0) break; depth--; }
                start--;
            }
            int end = start;
            depth = 0;
            bool inStr = false;
            for (int i = start; i < json.Length; i++)
            {
                char c = json[i];
                if (c == '"' && (i == 0 || json[i - 1] != '\\')) inStr = !inStr;
                if (inStr) continue;
                if (c == '{') depth++;
                else if (c == '}') { depth--; if (depth == 0) { end = i; break; } }
            }
            return end > start ? json.Substring(start, end - start + 1) : null;
        }

        public static void ApplySelfUpdate(string repoName, string pkgPrefix, string installerScript, System.Action<string> onStatus, System.Action onExit)
        {
            string exePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
            string appDir = System.IO.Path.GetDirectoryName(exePath);
            if (System.IO.Directory.Exists(System.IO.Path.Combine(appDir, ".git")))
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("https://github.com/nillynp/" + repoName + "/releases/latest") { UseShellExecute = true });
                if (onStatus != null) onStatus("Άνοιξε το GitHub Release (φάκελος Git).");
                return;
            }

            if (onStatus != null) onStatus("Έλεγχος SHA-256 στο GitHub...");
            string relJson = HttpGetText("https://api.github.com/repos/nillynp/" + repoName + "/releases/latest", 12000);
            if (string.IsNullOrEmpty(relJson)) throw new System.IO.InvalidDataException("Κενή απόκριση GitHub.");
            if (System.Text.RegularExpressions.Regex.IsMatch(relJson, "\"draft\"\\s*:\\s*true") ||
                System.Text.RegularExpressions.Regex.IsMatch(relJson, "\"prerelease\"\\s*:\\s*true"))
                throw new System.IO.InvalidDataException("Μη σταθερή έκδοση.");

            System.Text.RegularExpressions.Match tm = System.Text.RegularExpressions.Regex.Match(relJson, "\"tag_name\"\\s*:\\s*\"(v[0-9]+\\.[0-9]+(?:\\.[0-9]+)?)\"");
            if (!tm.Success) throw new System.IO.InvalidDataException("Μη έγκυρο tag έκδοσης.");
            string tag = tm.Groups[1].Value;

            System.Version curRaw = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
            System.Version curVer = new System.Version(curRaw.Major, curRaw.Minor, curRaw.Build >= 0 ? curRaw.Build : 0, 0);
            System.Version remVer;
            if (!TryParseVer(tag, out remVer) || remVer <= curVer)
                throw new System.InvalidOperationException("Έχεις ήδη την τελευταία έκδοση.");

            string zipName = pkgPrefix + "-" + tag + "-Portable.zip";
            string expectedUrl = "https://github.com/nillynp/" + repoName + "/releases/download/" + tag + "/" + zipName;
            string blk = ExtractAssetBlock(relJson, zipName);
            if (string.IsNullOrEmpty(blk)) throw new System.IO.FileNotFoundException("Δεν βρέθηκε το Portable ZIP.");
            if (!System.Text.RegularExpressions.Regex.IsMatch(blk, "\"state\"\\s*:\\s*\"uploaded\""))
                throw new System.IO.InvalidDataException("Το αρχείο δεν είναι έτοιμο.");
            System.Text.RegularExpressions.Match um = System.Text.RegularExpressions.Regex.Match(blk, "\"browser_download_url\"\\s*:\\s*\"([^\"]+)\"");
            if (!um.Success || !string.Equals(um.Groups[1].Value, expectedUrl, System.StringComparison.Ordinal))
                throw new System.IO.InvalidDataException("Μη έγκυρο URL λήψης.");
            System.Text.RegularExpressions.Match dm = System.Text.RegularExpressions.Regex.Match(blk, "\"digest\"\\s*:\\s*\"sha256:([0-9a-f]{64})\"");
            if (!dm.Success) throw new System.IO.InvalidDataException("Απουσιάζει SHA-256.");
            string expectedSha = dm.Groups[1].Value;

            string tmpDir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "NillyUpd-" + System.Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(tmpDir);
            string zipFile = System.IO.Path.Combine(tmpDir, "pkg.zip");

            if (onStatus != null) onStatus("Λήψη " + tag + "...");
            try { System.Net.ServicePointManager.SecurityProtocol |= (System.Net.SecurityProtocolType)3072 | System.Net.SecurityProtocolType.Tls12; } catch { }
            System.Net.HttpWebRequest dreq = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(expectedUrl);
            dreq.UserAgent = "NillySuite-Updater/1.0 (https://nillygraphics.com/)";
            dreq.Timeout = 20000;
            dreq.ReadWriteTimeout = 30000;
            using (System.Net.HttpWebResponse dresp = (System.Net.HttpWebResponse)dreq.GetResponse())
            using (System.IO.Stream src = dresp.GetResponseStream())
            using (System.IO.FileStream dst = new System.IO.FileStream(zipFile, System.IO.FileMode.Create, System.IO.FileAccess.Write, System.IO.FileShare.None))
            {
                byte[] buf = new byte[16384];
                int n; long total = 0;
                while ((n = src.Read(buf, 0, buf.Length)) > 0)
                {
                    total += n;
                    if (total > 32L * 1024L * 1024L) throw new System.IO.InvalidDataException("Υπέρβαση μεγέθους ZIP.");
                    dst.Write(buf, 0, n);
                }
            }

            if (onStatus != null) onStatus("Επαλήθευση SHA-256...");
            string actualSha;
            using (System.Security.Cryptography.SHA256 sha = System.Security.Cryptography.SHA256.Create())
            using (System.IO.FileStream fs = System.IO.File.OpenRead(zipFile))
            {
                byte[] hash = sha.ComputeHash(fs);
                System.Text.StringBuilder sb = new System.Text.StringBuilder(64);
                for (int i = 0; i < hash.Length; i++) sb.Append(hash[i].ToString("x2", System.Globalization.CultureInfo.InvariantCulture));
                actualSha = sb.ToString();
            }
            if (!string.Equals(actualSha, expectedSha, System.StringComparison.OrdinalIgnoreCase))
            {
                try { System.IO.Directory.Delete(tmpDir, true); } catch { }
                throw new System.IO.InvalidDataException("Αποτυχία ελέγχου SHA-256.");
            }

            if (onStatus != null) onStatus("Εγκατάσταση " + tag + " & επανεκκίνηση...");
            string ps1 = System.IO.Path.Combine(tmpDir, "apply.ps1");
            string script =
                "param($myPid,$zip,$appDir,$instName,$exePath,$tag)\r\n" +
                "for($i=0;$i -lt 60;$i++){ if(-not (Get-Process -Id $myPid -ErrorAction SilentlyContinue)){break}; Start-Sleep -Milliseconds 150 }\r\n" +
                "Add-Type -AssemblyName System.IO.Compression.FileSystem\r\n" +
                "$za = [System.IO.Compression.ZipFile]::OpenRead($zip)\r\n" +
                "try {\r\n" +
                "  $pref = $null; $shared = $true\r\n" +
                "  foreach($e in $za.Entries){ $fn=$e.FullName -replace '\\\\','/'; $sl=$fn.IndexOf('/'); if($sl -le 0){$shared=$false;break}; $p=$fn.Substring(0,$sl+1); if(-not $pref){$pref=$p}elseif(-not $pref.Equals($p,[StringComparison]::OrdinalIgnoreCase)){$shared=$false;break} }\r\n" +
                "  $rootFull = [System.IO.Path]::GetFullPath($appDir).TrimEnd('\\') + '\\'\r\n" +
                "  foreach($e in $za.Entries){\r\n" +
                "    $rel = $e.FullName -replace '\\\\','/'\r\n" +
                "    if($shared -and $pref -and $rel.StartsWith($pref,[StringComparison]::OrdinalIgnoreCase)){ $rel=$rel.Substring($pref.Length) }\r\n" +
                "    if([string]::IsNullOrEmpty($rel) -or $rel.EndsWith('/') -or $rel.Contains(':')){ continue }\r\n" +
                "    $dst = [System.IO.Path]::GetFullPath((Join-Path $appDir ($rel -replace '/','\\')))\r\n" +
                "    if(-not $dst.StartsWith($rootFull,[StringComparison]::OrdinalIgnoreCase)){ continue }\r\n" +
                "    $par = Split-Path -Parent $dst; if($par){ New-Item -ItemType Directory -Force -Path $par | Out-Null }\r\n" +
                "    for($k=0;$k -lt 5;$k++){ try { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e,$dst,$true); break } catch { Start-Sleep -Milliseconds 250 } }\r\n" +
                "  }\r\n" +
                "} finally { $za.Dispose() }\r\n" +
                "$bak = $exePath + '.bak'\r\n" +
                "if(Test-Path $exePath){ Copy-Item -LiteralPath $exePath -Destination $bak -Force -ErrorAction SilentlyContinue; for($k=0;$k -lt 5;$k++){ try { Remove-Item -LiteralPath $exePath -Force -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 250 } } }\r\n" +
                "Get-ChildItem (Join-Path $appDir 'desktop') -Filter '*.cs' -ErrorAction SilentlyContinue | ForEach-Object { $_.LastWriteTimeUtc = [DateTime]::UtcNow }\r\n" +
                "if($instName -and (Test-Path (Join-Path $appDir $instName))){ & (Join-Path $appDir $instName) -Silent 2>$null | Out-Null }\r\n" +
                "if(-not (Test-Path $exePath) -and (Test-Path $bak)){ Move-Item -LiteralPath $bak -Destination $exePath -Force -ErrorAction SilentlyContinue } else { Remove-Item -LiteralPath $bak -Force -ErrorAction SilentlyContinue }\r\n" +
                "if($tag){ Set-Content -LiteralPath (Join-Path $appDir '.nilly_version') -Value $tag -Encoding UTF8 -ErrorAction SilentlyContinue }\r\n" +
                "if(Test-Path $exePath){ Start-Process -FilePath $exePath -WorkingDirectory $appDir }\r\n" +
                "Start-Sleep -Milliseconds 400\r\n" +
                "Remove-Item -LiteralPath (Split-Path $zip) -Recurse -Force -ErrorAction SilentlyContinue\r\n";
            System.IO.File.WriteAllText(ps1, script, new System.Text.UTF8Encoding(false));

            int myPid = System.Diagnostics.Process.GetCurrentProcess().Id;
            System.Diagnostics.ProcessStartInfo psi = new System.Diagnostics.ProcessStartInfo(
                "powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + ps1 + "\" " +
                myPid + " \"" + zipFile + "\" \"" + appDir + "\" \"" + installerScript + "\" \"" + exePath + "\" \"" + tag + "\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            System.Diagnostics.Process.Start(psi);
            if (onExit != null) onExit();
        }
    }
}
