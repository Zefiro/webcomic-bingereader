<html>
<head>
<script>
window.addEventListener('beforeunload', function (e) {
	console.log("gone...")
	window.opener.childClosed();
});

</script>
</head><body>
Updating...<br>
<br>
<code><pre>
<?php
// remember: data files need to be writeable by group www-data, e.g.
// -rw-rw-r--  1 zefiro www-data 30235 May 23 01:00 ssData.js
$knownStrips = array("twb", "ss", "cc", "9to9", "oots", "chupa", "td");
$strip = $_GET['strip'];
if (in_array($strip, $knownStrips, true))  {
	// from https://stackoverflow.com/a/20109859/131146
	while (@ ob_end_flush()); // end all output buffers if any
	$cmd = '/samba/apache/cave.zefiro.de/binge/updater/reader.js ' . $strip . ' 2>&1';
	$proc = popen($cmd, 'r');
	while (!feof($proc)) {
		echo fread($proc, 4096);
		@ flush();
	}
	pclose($proc);
} else {
	print "unknown strip";
}
?>
</pre></code>

<br>
You can <a href="javascript:window.close()">close this window</a> now.</br>

<script>
	window.opener.updateFinished();
</script>
</body>
</html>
