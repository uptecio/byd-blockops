package au.local.blockops.updates;

import android.content.Context;
import java.io.*;
import java.net.*;
import java.security.Principal;
import java.security.cert.Certificate;
import javax.net.ssl.HttpsURLConnection;
import java.util.concurrent.*;
import static au.local.blockops.updates.UpdateModel.*;
import static au.local.blockops.updates.UpdatePorts.*;

/** Deterministic transport ONLY in the instrumentation APK. APK validation stays real. */
final class FixtureUpdateSource implements ReleaseSource,HttpsUpdateTransport.ConnectionOpener {
    static Clock realClock(){return new Clock(){public long wallMillis(){return System.currentTimeMillis();}public long elapsedMillis(){return android.os.SystemClock.elapsedRealtime();}};}
    static String liveCheck(Context context)throws Exception {
        HttpsUpdateTransport transport=new HttpsUpdateTransport(url->(HttpsURLConnection)url.openConnection(),realClock());
        UpdateCancellation cancellation=new UpdateCancellation();
        Release latest=new GithubReleaseClient(transport).latest(cancellation);
        UpdateCandidateStore store=new UpdateCandidateStore(new File(context.getFilesDir(),"updater-live-download-test"),transport);
        Candidate candidate=store.download(latest,cancellation,(n,total)->{});
        UpdateCandidateStore.verifyBytes(candidate);
        String validation;
        try {new AndroidApkVerifier(context).inspect(candidate,AndroidApkVerifier.readInstalled(context));validation="newer_verified_no_install";}
        catch(Failure failure){validation=failure.code;}
        return new org.json.JSONObject().put("tag",latest.tag).put("sha256",latest.sha256).put("bytes",candidate.file.length()).put("validation",validation).put("tls","platform default trust; fixed production source; no installation").toString();
    }
    /** Real loopback TLS sockets; trust and host mapping are local to each connection. */
    static String socketTiming(Context tests)throws Exception {
        java.security.KeyStore keys=java.security.KeyStore.getInstance("PKCS12");
        try(InputStream in=tests.getAssets().open("socket-fixture-api26.p12")){keys.load(in,"socket-fixture".toCharArray());}
        javax.net.ssl.KeyManagerFactory keyManagers=javax.net.ssl.KeyManagerFactory.getInstance(javax.net.ssl.KeyManagerFactory.getDefaultAlgorithm());keyManagers.init(keys,"socket-fixture".toCharArray());
        javax.net.ssl.TrustManagerFactory trust=javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm());trust.init(keys);
        javax.net.ssl.SSLContext tls=javax.net.ssl.SSLContext.getInstance("TLS");tls.init(keyManagers.getKeyManagers(),trust.getTrustManagers(),null);
        org.json.JSONArray evidence=new org.json.JSONArray();
        for(boolean headers:new boolean[]{true,false}){
            javax.net.ssl.SSLServerSocket server=(javax.net.ssl.SSLServerSocket)tls.getServerSocketFactory().createServerSocket(0,1,InetAddress.getByName("127.0.0.1"));
            ExecutorService threads=Executors.newFixedThreadPool(3);CountDownLatch waiting=new CountDownLatch(1);java.util.concurrent.atomic.AtomicReference<java.net.Socket> accepted=new java.util.concurrent.atomic.AtomicReference<>();
            UpdateCancellation token=new UpdateCancellation();
            try {
                Future<?> serving=threads.submit(()->{try{
                    java.net.Socket socket=server.accept();accepted.set(socket);socket.setSoTimeout(12000);
                    InputStream input=socket.getInputStream();int state=0;while(state<4){int c=input.read();if(c<0)throw new IOException("Client closed before request");state=c==("\r\n\r\n".charAt(state))?state+1:0;}
                    if(!headers){socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\nx".getBytes(java.nio.charset.StandardCharsets.US_ASCII));socket.getOutputStream().flush();}
                    waiting.countDown();while(input.read()!=-1){}return null;
                }catch(Exception e){throw new RuntimeException(e);}});
                HttpsUpdateTransport transport=new HttpsUpdateTransport(ignored->{
                    HttpsURLConnection connection=(HttpsURLConnection)new URL("https://127.0.0.1:"+server.getLocalPort()+"/").openConnection();
                    connection.setSSLSocketFactory(tls.getSocketFactory());connection.setHostnameVerifier((host,session)->"127.0.0.1".equals(host));return connection;
                },realClock());
                Future<String> transfer=threads.submit(()->{try{transport.copy(URI.create("https://github.com/uptecio/byd-blockops/releases/download/v0.11.1/block-ops-v0.11.1.apk"),new ByteArrayOutputStream(),100,token,(n,total)->{});return "unexpected_success";}catch(Failure failure){return failure.code;}});
                if(!waiting.await(10,TimeUnit.SECONDS))throw new AssertionError("TLS server did not observe request headers");
                long start=android.os.SystemClock.elapsedRealtime();token.cancel(threads);
                if(!"cancelled".equals(transfer.get(8,TimeUnit.SECONDS)))throw new AssertionError("Real socket cancellation failed");
                evidence.put(new org.json.JSONObject().put("stalled",headers?"headers":"body").put("cancelMillis",android.os.SystemClock.elapsedRealtime()-start));
            }finally{token.cancel(threads);java.net.Socket socket=accepted.get();if(socket!=null)socket.close();server.close();threads.shutdownNow();}
        }
        return evidence.toString();
    }
    private final byte[] bytes;
    private final String mode;
    private final Release release;
    FixtureUpdateSource(Context tests,String fixture,String mode) throws Exception {
        this.mode=mode;
        if(!fixture.matches("valid|wrongPackage|wrongSigner|older|malformed|truncated"))throw new IllegalArgumentException("Unknown fixture");
        try(InputStream input=tests.getAssets().open(fixture+".apk");ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1)output.write(buffer,0,n);bytes=output.toByteArray();
        }
        String digest=HttpsUpdateTransport.hex(HttpsUpdateTransport.sha256().digest(bytes));
        Asset asset=new Asset(1601,"block-ops-v0.11.1.apk",URI.create("https://github.com/uptecio/byd-blockops/releases/download/v0.11.1/block-ops-v0.11.1.apk"),bytes.length,"sha256:"+digest);
        release=new Release(1600,"v0.11.1",new Version(0,11,1),asset,digest,"Private acceptance fixture; never published.");
    }
    public Release latest(UpdateCancellation token)throws Failure{token.check();return release;}
    public HttpsURLConnection open(URL url){return new HttpsURLConnection(url){
        private volatile boolean disconnected;
        public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){disconnected=true;}
        public String getCipherSuite(){return "SCRIPTED-FIXTURE-NO-TLS";}
        public Certificate[] getLocalCertificates(){return null;}public Certificate[] getServerCertificates(){return new Certificate[0];}
        public Principal getPeerPrincipal(){return null;}public Principal getLocalPrincipal(){return null;}
        public int getResponseCode()throws IOException{if("transferError".equals(mode))throw new IOException("Scripted transfer failure");return 200;}
        public String getHeaderField(String name){return "Content-Length".equalsIgnoreCase(name)?Integer.toString(bytes.length):null;}
        public InputStream getInputStream(){return new InputStream(){int position;
            public int read()throws IOException{byte[] b=new byte[1];return read(b,0,1)<0?-1:b[0]&255;}
            public int read(byte[] output,int offset,int length)throws IOException{
                if(disconnected)throw new IOException("Disconnected fixture");
                boolean slow="slow".equals(mode)||"recreate".equals(mode);
                if(slow)android.os.SystemClock.sleep(100);
                int limit="shortTransfer".equals(mode)?bytes.length/2:bytes.length;
                if(position>=limit)return -1;
                int n=Math.min(Math.min(length,slow?1024:8192),limit-position);
                System.arraycopy(bytes,position,output,offset,n);position+=n;return n;
            }
        };}
    };}
}
