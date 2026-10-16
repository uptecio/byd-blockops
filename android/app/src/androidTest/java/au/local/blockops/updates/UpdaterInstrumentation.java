package au.local.blockops.updates;

import android.app.Instrumentation;
import android.os.Bundle;

/** No test entry point is included in the production APK. */
public final class UpdaterInstrumentation extends Instrumentation {
    private Bundle arguments;
    @Override public android.app.Application newApplication(ClassLoader loader,String className,android.content.Context context)
            throws InstantiationException,IllegalAccessException,ClassNotFoundException {
        return super.newApplication(getClass().getClassLoader(),FixtureApplication.class.getName(),context);
    }
    @Override public void onCreate(Bundle arguments) {
        this.arguments = arguments;
        FixtureApplication.arguments=arguments;
        FixtureApplication.testContext=getContext();
        start();
    }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            String suite=arguments.getString("suite");
            if("cleanupSentinel".equals(suite)){
                java.io.File file=new java.io.File(getTargetContext().getFilesDir(),"updater-fixture-sentinel.txt");
                int id=Integer.parseInt(new String(java.nio.file.Files.readAllBytes(file.toPath()),java.nio.charset.StandardCharsets.UTF_8));
                android.content.pm.PackageInstaller installer=getTargetContext().getPackageManager().getPackageInstaller();
                if(!installer.getMySessions().stream().anyMatch(session->session.getSessionId()==id))throw new AssertionError("Unrelated sentinel session was unexpectedly removed");
                installer.abandonSession(id);if(!file.delete())throw new AssertionError("Sentinel cleanup marker failed");
                result.putString("stream","PASS cleanupSentinel "+id+"\n");finish(-1,result);return;
            }
            if("network".equals(suite)){
                passed("socketTiming "+FixtureUpdateSource.socketTiming(getContext()));
                passed("liveGithub "+FixtureUpdateSource.liveCheck(getTargetContext()));
                result.putString("stream","PASS network\n");finish(-1,result);return;
            }
            if ("acceptance".equals(suite)) {
                startActivitySync(new android.content.Intent(getTargetContext(), au.local.blockops.MainActivity.class)
                    .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
                long sequence=0;
                android.app.UiAutomation automation=getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
                android.accessibilityservice.AccessibilityServiceInfo info=automation.getServiceInfo();info.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;automation.setServiceInfo(info);
                snapshotNativeUi(++sequence);
                passed("acceptanceHostReady");
                // The external host survives package replacement, unlike instrumentation.
                while (true) {((FixtureApplication)getTargetContext().getApplicationContext()).observeSubmissionBoundary();snapshotNativeUi(++sequence);android.os.SystemClock.sleep(200);}
            }
            if (!"installer".equals(suite)&&!"controller".equals(suite)&&!"bridge".equals(suite)) throw new AssertionError("Unknown suite");
            UpdaterAndroidTest tests=new UpdaterAndroidTest(this);
            if("bridge".equals(suite))tests.bridge();else tests.run();
            if("controller".equals(suite))tests.controller();
            result.putString("stream", "PASS "+suite+"\n");
            finish(-1, result);
        } catch (Throwable failure) {
            result.putString("stream", "FAIL "+arguments.getString("suite")+": " + android.util.Log.getStackTraceString(failure));
            finish(0, result);
        }
    }
    void passed(String name) {
        Bundle result = new Bundle();
        result.putString("stream", "PASS " + name + "\n");
        sendStatus(0, result);
    }
    /** Read-only native accessibility; unlike shell uiautomator, no wait-for-idle. */
    private void snapshotNativeUi(long sequence)throws Exception {
        android.view.accessibility.AccessibilityNodeInfo root=getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).getRootInActiveWindow();
        if(root==null)return;
        java.io.StringWriter text=new java.io.StringWriter();org.xmlpull.v1.XmlSerializer xml=android.util.Xml.newSerializer();xml.setOutput(text);xml.startTag(null,"hierarchy");
        nativeNode(xml,root,new int[]{0},0);xml.endTag(null,"hierarchy");xml.flush();
        org.json.JSONObject value=new org.json.JSONObject().put("pid",android.os.Process.myPid()).put("sequence",sequence).put("elapsed",android.os.SystemClock.elapsedRealtime()).put("xml",text.toString());
        java.io.File file=new java.io.File(getTargetContext().getFilesDir(),"updater-fixture-ui.json"),partial=new java.io.File(getTargetContext().getFilesDir(),"updater-fixture-ui.tmp");
        try(java.io.FileWriter out=new java.io.FileWriter(partial)){out.write(value.toString());}
        java.nio.file.Files.move(partial.toPath(),file.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING,java.nio.file.StandardCopyOption.ATOMIC_MOVE);
    }
    private void nativeNode(org.xmlpull.v1.XmlSerializer xml,android.view.accessibility.AccessibilityNodeInfo node,int[] count,int depth)throws Exception {
        if(depth>64||++count[0]>2048)return;
        android.graphics.Rect bounds=new android.graphics.Rect();node.getBoundsInScreen(bounds);
        xml.startTag(null,"node");xml.attribute(null,"text",bounded(node.getText()));xml.attribute(null,"content-desc",bounded(node.getContentDescription()));
        xml.attribute(null,"class",bounded(node.getClassName()));xml.attribute(null,"package",bounded(node.getPackageName()));xml.attribute(null,"resource-id",bounded(node.getViewIdResourceName()));
        xml.attribute(null,"enabled",Boolean.toString(node.isEnabled()));xml.attribute(null,"visible-to-user",Boolean.toString(node.isVisibleToUser()));xml.attribute(null,"bounds",bounds.toShortString());
        xml.attribute(null,"checkable",Boolean.toString(node.isCheckable()));xml.attribute(null,"checked",Boolean.toString(node.isChecked()));
        for(int i=0;i<node.getChildCount()&&count[0]<2048;i++){android.view.accessibility.AccessibilityNodeInfo child=node.getChild(i);if(child!=null)nativeNode(xml,child,count,depth+1);}
        xml.endTag(null,"node");
    }
    private static String bounded(CharSequence value){if(value==null)return "";String text=value.toString();return text.length()>4096?text.substring(0,4096):text;}
}
