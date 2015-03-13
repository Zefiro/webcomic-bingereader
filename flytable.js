function setupFlyTable(element) {
	
	var table = {};
	table.container = element;
	table.recycle = [];
	table.inUse = [];
	table.sliceStart = 1/0;
	table.sliceEnd = -1;

	// extra space on either side to render
	table.scrollPadding = 10;
	
	/* Public Overrides */
	
	table.recalculate = function() {}
	
	table.getComponent = function(index, recycle) {
		if(!recycle) {
			recycle = $("<s>no renderer</s>");
		}
		
		return recycle;
	}
	
	table.getItemTop = function(index) {
		return this.getItemHeight(0)*index; // arbitrary value
	}
	
	table.getItemHeight = function(index) {
		return 16; // arbitrary value
	}
	
	table.getTotalHeight = function() {
		return 160; // arbitrary value
	}

	table.pixelToIndex = function(y) {
		return ~~(y / this.getItemHeight(0));
	}

	/* Internal Functions */
	
	function recycleOffscreenNodes(table, startY, endY) {
	}
	function recycleAllNodes(table) {
		var inUse = table.inUse;
		var recycle = table.recycle;
		
		for(var i = 0; i < inUse.length; i++) {
			recycle.push(inUse[i]);
		}
		
		table.inUse = [];
		table.sliceStart = 1/0;
		table.sliceEnd = -1;
	}
	
	function includeInSlice(table, index) {
		table.sliceStart = Math.min(index, table.sliceStart);
		table.sliceEnd = Math.max(table.sliceEnd, index);
	};

	function grabNode() {
		if(table.recycle.length > 0) {
			return table.recycle.pop();
		}
		return false;
	}
	
	// util, limit an event handler to only run every 20ms
	function burnout(func) {
		var burnedOut = false;
		return function(evt) {
			if(burnedOut) {
				return;
			}
			burnedOut = true;
			window.setTimeout(function() {burnedOut = false;}, 20);
			return func.apply(this, evt);
		}
	}
	
	function renderSlice(startY, endY) {
		// prepare table element
		var container = table.container;
		table.recalculate();
		var height = table.getTotalHeight();

		container.css({
			position: "relative",
			height: height
		});
		
		// pad region
		startY = Math.max(0, startY - table.scrollPadding);
		endY = Math.min(endY + table.scrollPadding, height)
		
		// clear offscreen nodes
		recycleAllNodes(table);
		container.empty();

		// loop through onscreen blocks
		var index = table.pixelToIndex(startY);

		for(var y = table.getItemTop(index); y < endY;) {
			var h = table.getItemHeight(index);
			var element = table.getComponent(index, grabNode());
			element.css({
				position: "absolute",
				left: "0",
				right: "0",
				top: y
			});
			element.data("flytable-index", index);
			includeInSlice(table, index);
			container.append(element);
			index++;
			y += h;
		}
		
		//console.log(height + "pixels high")
	}
	
	/* Public Methods */
	
	table.render = function() {
		var screenY = $(window).scrollTop();
		var tableY = this.container.offset().top;
		var delta = screenY - tableY;
		renderSlice(delta, delta + $(window).height());
	}
	
	// utility for displaying datasets of uniform row height
	// renderFunc(index of item, jQuery-wrapped node to render to)
	table.simpleDataset = function(getDataCount, templateSelector, renderFunc) {
		var tmpl;
		var rowHeight;
		
		this.recalculate = function() {
			tmpl = $(templateSelector);
			rowHeight = tmpl.height();
		}
		
		this.getComponent = function(index, node) {
			if(!node) {
				node = tmpl.clone();
			}
		
			renderFunc(index, node);
			
			return node;
		}
		
		this.getItemTop = function(index) {
			return rowHeight*index;
		}
		
		this.getItemHeight = function(index) {
			return rowHeight;
		}

		this.getTotalHeight = function() {
			return rowHeight * getDataCount();
		}
	}
	
	// utility for displaying array-based datasets
	// renderFunc(item value, jQuery-wrapped node to render to, index of item)
	table.simpleArray = function(array, templateSelector, renderFunc) {
		this.simpleDataset(
			function() {return array.length;},
			templateSelector,
			function(index, node) {
				renderFunc(array[index], node, index)
			}
		)
	}
	
	/* End */
	
	return table;
}
