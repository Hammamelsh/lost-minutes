"""Clearly-labelled SIRI-VM fixtures. Synthetic data for controlled failure cases only."""
import io
import zipfile

ACTIVITY = """
    <VehicleActivity>
      <RecordedAtTime>{recorded}</RecordedAtTime>
      <MonitoredVehicleJourney>
        <LineRef>{route}</LineRef>
        <DirectionRef>{direction}</DirectionRef>
        <FramedVehicleJourneyRef>
          <DatedVehicleJourneyRef>{journey}</DatedVehicleJourneyRef>
        </FramedVehicleJourneyRef>
        <OperatorRef>{operator}</OperatorRef>
        <VehicleLocation><Longitude>{lon}</Longitude><Latitude>{lat}</Latitude></VehicleLocation>{bearing}
        <DestinationName>{destination}</DestinationName>
        <VehicleRef>{vehicle}</VehicleRef>
      </MonitoredVehicleJourney>
    </VehicleActivity>"""

DOCUMENT = """<?xml version="1.0" encoding="UTF-8"?>
<Siri xmlns="http://www.siri.org.uk/siri" version="2.0">
  <ServiceDelivery>
    <VehicleMonitoringDelivery>{activities}
    </VehicleMonitoringDelivery>
  </ServiceDelivery>
</Siri>
"""


def bus(recorded, lat=53.470, lon=-2.240, vehicle='V1', operator='TEST', route='142',
        direction='inbound', journey='J1', destination='Piccadilly', bearing=None):
    """`bearing=None` omits the element; any other value is written verbatim, so a test can
    supply an invalid one such as '-5' or 'NaN'."""
    return ACTIVITY.format(recorded=recorded, lat=lat, lon=lon, vehicle=vehicle,
                           operator=operator, route=route, direction=direction,
                           journey=journey, destination=destination,
                           bearing='' if bearing is None else f'<Bearing>{bearing}</Bearing>')


def siri_document(activities):
    """Raw XML, as the live datafeed returns it."""
    return DOCUMENT.format(activities=''.join(activities)).encode('utf-8')


def snapshot_zip(activities):
    """A zipped response, as the archive publishes it."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('siri.xml', DOCUMENT.format(activities=''.join(activities)))
    return buffer.getvalue()
