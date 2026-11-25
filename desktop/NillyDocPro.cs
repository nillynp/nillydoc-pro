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
[assembly: AssemblyVersion("1.5.1.0")]
[assembly: AssemblyFileVersion("1.5.1.0")]

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

            SendResponse(stream, 404, "Not Found", "text/plain", Encoding.ASCII.GetBytes("Not found"), null);
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
}
