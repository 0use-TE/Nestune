package net.ouse.nestune.probe;
import android.app.*;import android.content.*;import android.os.*;import java.io.*;import java.net.*;import java.lang.reflect.*;import java.security.*;import org.json.*;
/** Isolated emulator fixture; never installs or contacts the production server. */
public class UpdatesProbe extends Instrumentation {
 private Activity activity;private byte[] good,bad;private Method request;private Class<?> nativeClass,function;
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 private byte[] asset(String name)throws Exception{try(InputStream in=getContext().getAssets().open(name);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[65536];int n;while((n=in.read(b))>0)out.write(b,0,n);return out.toByteArray();}}
 private String hash(byte[] data)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(data))s.append(String.format("%02x",b&255));return s.toString();}
 private JSONObject call(Object updater,String type)throws Exception{Object[] result={null};Throwable[] error={null};runOnMainSync(()->{try{result[0]=request.invoke(updater,type);}catch(Throwable e){error[0]=e;}});if(error[0]!=null)throw new RuntimeException(error[0]);return (JSONObject)result[0];}
 private Object updater(byte[] apk,boolean wrongHash,int[] downloads)throws Exception{
  JSONObject item=new JSONObject().put("version","1.2.4").put("versionCode",9).put("size",apk.length).put("sha256",wrongHash?"0".repeat(64):hash(apk)).put("url","/api/client-updates/android/9");
  byte[] manifest=new JSONObject().put("android",item).toString().getBytes("UTF-8");
  Object transport=java.lang.reflect.Proxy.newProxyInstance(function.getClassLoader(),new Class<?>[]{function},(proxy,method,args)->{
   if(args==null||args.length!=1||!(args[0] instanceof String))return null;boolean packageRequest=!args[0].equals("/api/client-updates");if(packageRequest)downloads[0]++;
   byte[] payload=packageRequest?apk:manifest;
   return new HttpURLConnection(new URL("https://nestune.0use.net:8443"+args[0])){
    public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
    public InputStream getInputStream(){return new ByteArrayInputStream(payload){@Override public synchronized int read(byte[] b,int off,int len){if(packageRequest)SystemClock.sleep(2);return super.read(b,off,Math.min(len,32768));}};}
   };
  });
  Constructor<?> constructor=nativeClass.getDeclaredConstructor(Activity.class,function);constructor.setAccessible(true);return constructor.newInstance(activity,transport);
 }
 private JSONObject finishDownload(Object updater)throws Exception{boolean progress=false;for(int i=0;i<300;i++){JSONObject s=call(updater,"updateStatus");String phase=s.optString("phase");if(phase.equals("downloading")&&s.optLong("received")>0&&s.optLong("received")<s.optLong("total"))progress=true;if(phase.equals("ready")||phase.equals("error")){if(!progress)throw new AssertionError("No real download progress");return s;}SystemClock.sleep(30);}throw new AssertionError("Download timeout");}
 @Override public void onStart(){Bundle report=new Bundle();try{
  activity=startActivitySync(new Intent().setClassName("net.ouse.nestune","net.ouse.nestune.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  nativeClass=Class.forName("net.ouse.nestune.ClientUpdates");for(Constructor<?> c:nativeClass.getDeclaredConstructors())if(c.getParameterCount()==2)function=c.getParameterTypes()[1];if(function==null)throw new AssertionError("Missing injectable constructor");request=nativeClass.getDeclaredMethod("request",String.class);request.setAccessible(true);
  good=asset("good.apk");bad=asset("bad.apk");int[] count={0};Object valid=updater(good,false,count);
  if(call(valid,"updateInfo").getInt("updateProtocol")!=1)throw new AssertionError("Missing update capability");
  call(valid,"updateStart");call(valid,"updateStart");JSONObject ready=finishDownload(valid);if(!ready.getString("phase").equals("ready")||count[0]!=1)throw new AssertionError("Download/concurrency failed: "+ready);
  IntentFilter installFilter=new IntentFilter(Intent.ACTION_VIEW);installFilter.addDataType("application/vnd.android.package-archive");installFilter.addDataScheme("content");Instrumentation.ActivityMonitor installer=addMonitor(installFilter,null,true);call(valid,"updateInstall");
  JSONObject state=call(valid,"updateStatus");boolean permission=state.optString("phase").equals("permission");if(!permission&&installer.getHits()!=1)throw new AssertionError("Installer did not open");removeMonitor(installer);
  Object corrupt=updater(good,true,new int[]{0});call(corrupt,"updateStart");JSONObject rejected=finishDownload(corrupt);if(!rejected.optString("error").contains("校验"))throw new AssertionError("Corrupt package accepted: "+rejected);
  Object wrongSigner=updater(bad,false,new int[]{0});call(wrongSigner,"updateStart");JSONObject signed=finishDownload(wrongSigner);if(!signed.optString("error").contains("签名"))throw new AssertionError("Wrong signature accepted: "+signed);
  report.putString("report","NESTUNE_UPDATES_PASS: progress, duplicate-download guard, hash validation, same-signature upgrade, wrong-signature denial, "+(permission?"system install permission":"system installer handoff")+"; emulator only, no actual installation or server writes");finish(Activity.RESULT_OK,report);
 }catch(Throwable error){report.putString("failure",error.toString());error.printStackTrace();finish(Activity.RESULT_CANCELED,report);}}
}
