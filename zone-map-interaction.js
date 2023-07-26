function initZoneMap(mapContainer, form) {
  var carrierId = 1;
  var defaultZip = 83001; // Jackson, WY

  var zoneLookupTable = null;
  var zoneMap = new ZoneMap(mapContainer, {
    zoneLookup: function lookupZonesForOrigin(originZip) {
      if (zoneLookupTable == null) {
        throw new Error('Could not lookup zones. Table not (yet) loaded?');
      }

      var destinationZipMap =
        zoneLookupTable[`zip${originZip.substring(0, 3)}`] || {};

      return Object.keys(destinationZipMap).map((zip) => [
        zip.substr(3),
        destinationZipMap[zip],
      ]);
    },
    showStates: false,
    showStateLabels: false,
    showStateCodeLabels: false,
    showAreas: true,
    showAreaLabels: false,
    showTownLabels: false,
    showTownDots: false,
    showLegend: true,
    backgroundStyle: {
      fill: 'none',
      stroke: 'none',
    },
    arrowStyle: {
      strokeWidth: '2',
    },
    arrowRadius: 30,
    legendLabelStyle: {
      fontFamily: 'Mikado, sans-serif',
    },
  });

  var lookupZoneFromApiCache = {};
  var debouncedLookupZoneFromApi = debounce(lookupZoneFromApi, 500, true, true);
  var hasOrigin = false;
  var hasDestination = false;
  var arrow = null;
  var lastAnimationFrame;
  var lastArea;

  function modifyColorBrightness(color, amount) {
    var usePound = false;

    if (color[0] === '#') {
      color = color.slice(1);
      usePound = true;
    }

    var num = parseInt(color, 16);

    var r = (num >> 16) + amount;
    if (r > 255) r = 255;
    else if (r < 0) r = 0;

    var b = ((num >> 8) & 0x00ff) + amount;
    if (b > 255) b = 255;
    else if (b < 0) b = 0;

    var g = (num & 0x0000ff) + amount;
    if (g > 255) g = 255;
    else if (g < 0) g = 0;

    return (usePound ? '#' : '') + (g | (b << 8) | (r << 16)).toString(16);
  }

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds.
  function debounce(func, wait, leading = false, trailing = true) {
    var timeout;
    return function () {
      var context = this,
        args = arguments;
      var later = function () {
        timeout = null;
        if (trailing) func.apply(context, args);
      };
      var callNow = leading && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func.apply(context, args);
    };
  }

  function updateActiveAreas() {
    var originZip = form.elements.originZip.value;
    var destinationZip = form.elements.destinationZip.value;

    $(mapContainer)
      .find('.zoneMap-area--active')
      .removeClass('zoneMap-area--active')
      .each(function (area) {
        $(this).css('fill', '');
      });

    if (originZip) {
      $(mapContainer)
        .find('.zoneMap-area-' + originZip.substr(0, 3))
        .addClass('zoneMap-area--active')
        .each(function () {
          var color = $(this).attr('fill');
          if (color) {
            $(this).css('fill', modifyColorBrightness(color, -25));
          }
        });
    }
    if (destinationZip) {
      $(mapContainer)
        .find('.zoneMap-area-' + destinationZip.substr(0, 3))
        .addClass('zoneMap-area--active')
        .each(function () {
          var color = $(this).attr('fill');
          if (color) {
            $(this).css('fill', modifyColorBrightness(color, -25));
          }
        });
    }
  }

  function updateArrow() {
    var originZip = form.elements.originZip.value;
    var destinationZip = form.elements.destinationZip.value;

    if (arrow) {
      zoneMap.removeArrow(arrow);
      arrow = null;
    }

    if (originZip && destinationZip) {
      arrow = zoneMap.drawArrow(
        originZip.substr(0, 3),
        destinationZip.substr(0, 3)
      );
    }
  }

  function graphqlRequest(query, variables = {}) {
    return $.ajax({
      method: 'POST',
      url: 'https://api.pirateship.com/graphql',
      contentType: 'application/json',
      dataTye: 'json',
      data: JSON.stringify({
        query: query,
        variables: variables,
      }),
    }).done(function (res) {
      if (res.errors) {
        res.errors.forEach(function (error) {
          console.warn('GraphQL error: ' + error.message, error.extensions);
        });
      }
    });
  }

  function lookupZoneFromApi(originZip, destinationZip, doneCallback) {
    graphqlRequest(
      'query ($carrierId: ID!, $originZip: String!, $destinationZip: String!) { ' +
        'zoneForRoute(carrierId: $carrierId, originZip: $originZip, destinationZip: $destinationZip) ' +
        '}',
      {
        carrierId: carrierId,
        originZip: originZip,
        destinationZip: destinationZip,
      }
    ).done(function (res) {
      doneCallback(res.data.zoneForRoute);
    });
  }

  function cachedLookupZoneFromApi(originZip, destinationZip, doneCallback) {
    var cacheKey = originZip + '-' + destinationZip;
    if (lookupZoneFromApiCache[cacheKey]) {
      doneCallback(lookupZoneFromApiCache[cacheKey]);
    } else {
      debouncedLookupZoneFromApi(originZip, destinationZip, function (zone) {
        lookupZoneFromApiCache[cacheKey] = zone;
        doneCallback(zone);
      });
    }
  }

  function updateZoneOutput() {
    var originZip = form.elements.originZip.value;
    var destinationZip = form.elements.destinationZip.value;
    var output = document.getElementById('ps-zone-output');

    output.textContent = '';

    if (originZip && destinationZip) {
      // Update from lookup table first
      if (zoneLookupTable) {
        var zone =
          zoneLookupTable[`zip${originZip.substring(0, 3)}`][
            `zip${destinationZip.substring(0, 3)}`
          ];

        if (zone != null && zone > 0) {
          output.textContent = 'Zone ' + zone;
        }
      }

      // Also get a more exact result from the server
      cachedLookupZoneFromApi(originZip, destinationZip, function (zone) {
        output.textContent = 'Zone ' + zone;
      });
    }
  }

  // Load lookup table
  graphqlRequest(
    'query ($carrierId: ID!) { zoneTable(carrierId: $carrierId) }',
    { carrierId: carrierId }
  ).done(function (res) {
    zoneLookupTable = res.data.zoneTable;
    zoneMap.paintZones(String(defaultZip));
  });

  form.elements.originZip.addEventListener('input', function (event) {
    var zip = event.target.value.substr(0, 5);
    zoneMap.paintZones(zip);

    hasOrigin = true;
    updateActiveAreas();
    updateArrow();
    updateZoneOutput();
  });

  form.elements.destinationZip.addEventListener('input', function (event) {
    hasDestination = true;
    updateActiveAreas();
    updateArrow();
    updateZoneOutput();
  });

  zoneMap.addChangeListener(function (area) {
    var zip = String($(area).data('zip') || '').padEnd(5, '0');

    if (area && area !== lastArea) {
      if (lastAnimationFrame) {
        cancelAnimationFrame(lastAnimationFrame);
        lastAnimationFrame = null;
      }
      if (!hasOrigin) {
        lastAnimationFrame = requestAnimationFrame(function () {
          zoneMap.paintZones(zip);
        });
      }
      lastArea = area;
    }

    if (!hasOrigin) {
      form.elements.originZip.value = zip;
    } else if (!hasDestination) {
      form.elements.destinationZip.value = zip;
    }
    if (!hasDestination) {
      updateActiveAreas();
      updateArrow();
      updateZoneOutput();
    }
  });

  $(mapContainer).on('click', '.zoneMap-area', function () {
    var zip = $(this).data('zip');
    var paddedZip = String(zip).padEnd(5, '0');

    // reset
    if (hasOrigin && hasDestination) {
      hasOrigin = false;
      hasDestination = false;
      form.elements.originZip.value = '';
      form.elements.destinationZip.value = '';

      if (lastArea) {
        var zip = String($(lastArea).data('zip') || '').padEnd(5, '0');
        zoneMap.paintZones(zip);
        form.elements.originZip.value = zip;
      }
      // set originZip
    } else if (!hasOrigin) {
      hasOrigin = true;
      form.elements.originZip.value = paddedZip;
      // set destinationZip
    } else if (hasOrigin) {
      hasDestination = true;
      form.elements.destinationZip.value = paddedZip;
    }
    updateActiveAreas();
    updateArrow();
    updateZoneOutput();
  });
}
