package au.local.blockops.updates;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.widget.Button;
import static au.local.blockops.updates.UpdateModel.*;

/** Plain native text and explicit actions; the Activity owner must detach on pause/destruction. */
public final class UpdateDialog {
    private Activity activity;
    private final UpdateController controller;
    private AlertDialog dialog;
    public UpdateDialog(Activity activity,UpdateController controller){this.activity=activity;this.controller=controller;}
    public void show(){
        if(activity==null||activity.isFinishing()||activity.isDestroyed())return;
        if(dialog==null){
            dialog=new AlertDialog.Builder(activity).setTitle("Block Ops update").setMessage("")
                .setPositiveButton("Download",null).setNegativeButton("Later",null).setNeutralButton("Cancel",null).create();
            dialog.setOnCancelListener(ignored->controller.dismiss());
        }
        dialog.show();render(controller.snapshot());
    }
    public void render(Snapshot state){
        if(activity==null||activity.isDestroyed()||dialog==null||!dialog.isShowing())return;
        dialog.setMessage(UpdatePresentation.text(state,controller.releaseSummary()));
        Button action=dialog.getButton(DialogInterface.BUTTON_POSITIVE);
        String label="Check again";Runnable command=()->controller.check(true);boolean enabled=true;
        switch(state.phase){
            case "available":label="Download";command=controller::download;break;
            case "ready":label="Install";command=controller::install;break;
            case "permission":label="Open Settings";command=controller::openPermissionSettings;break;
            case "installing":label="Install";command=controller::install;enabled=controller.canConfirmInstall();break;
            case "checking":case "downloading":case "verifying":label="Please wait";enabled=false;break;
            case "error":label="Retry";break;
        }
        action.setText(label);action.setEnabled(enabled);Runnable chosen=command;
        action.setOnClickListener(view->{action.setEnabled(false);chosen.run();render(controller.snapshot());});
        Button later=dialog.getButton(DialogInterface.BUTTON_NEGATIVE);later.setText("Later");
        later.setOnClickListener(view->{controller.dismiss();dialog.dismiss();});
        Button cancel=dialog.getButton(DialogInterface.BUTTON_NEUTRAL);
        boolean active="checking".equals(state.phase)||"downloading".equals(state.phase)||"verifying".equals(state.phase)||"installing".equals(state.phase);
        cancel.setVisibility(active?android.view.View.VISIBLE:android.view.View.GONE);
        cancel.setText("installing".equals(state.phase)?"Cancel pending install":"Cancel");
        cancel.setOnClickListener(view->{cancel.setEnabled(false);controller.cancel();render(controller.snapshot());});
        cancel.setEnabled(active);
    }
    public void detach(){if(dialog!=null){dialog.setOnCancelListener(null);dialog.dismiss();dialog=null;}activity=null;}
}
